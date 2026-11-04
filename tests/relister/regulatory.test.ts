import { it, expect } from "vitest";
import { regulatoryPayload } from "../../lib/relister/regulatory";
import { publicationPayload } from "../../lib/relister/ebay";
import { samplePayload } from "../../lib/relister/simulation";
it("preserves documented manufacturer and responsible person fields", () => {
  const source = {
    Manufacturer: {
      CompanyName: "Fixture manufacturer",
      Country: "DE",
      CityName: "Fixture city",
      ContactURL: "https://example.invalid",
    },
    ResponsiblePersons: {
      ResponsiblePerson: {
        CompanyName: "Fixture contact",
        Country: "DE",
        Types: { Type: "EUResponsiblePerson" },
      },
    },
  };
  const result = regulatoryPayload(source)!;
  expect(result.Manufacturer).toEqual(source.Manufacturer);
  expect(result.ResponsiblePersons?.ResponsiblePerson[0].Types?.Type).toEqual([
    "EUResponsiblePerson",
  ]);
  expect(source.ResponsiblePersons.ResponsiblePerson.Types.Type).toBe(
    "EUResponsiblePerson",
  );
});
it.each([
  { Manufacturer: { ResponseOnly: "x" } },
  { EnergyEfficiencyLabel: { ImageURL: "https://example.invalid" } },
  {
    ResponsiblePersons: {
      ResponsiblePerson: { Types: { Type: "CustomCode" } },
    },
  },
])("blocks unsupported regulatory data instead of dropping it", (source) =>
  expect(() => regulatoryPayload(source)).toThrow(),
);
it("accepts zero shipping-discount sentinels and blocks active profiles", () => {
  const source = {
    ...samplePayload("100000000001"),
    ShippingDetails: {
      ShippingDiscountProfileID: "0",
      InternationalShippingDiscountProfileID: "0",
    },
  };
  expect(() => publicationPayload(source)).not.toThrow();
  source.ShippingDetails.ShippingDiscountProfileID = "123";
  expect(() => publicationPayload(source)).toThrow("ShippingDiscountProfileID");
});

it("keeps a brand-only catalog response through the identical existing brand aspect", () => {
  const source = {
    ...samplePayload("100000000001"),
    ProductListingDetails: { BrandMPN: { Brand: "Fixture brand" } },
    ItemSpecifics: {
      NameValueList: [{ Name: "Marke", Value: ["Fixture brand"] }],
    },
  };
  const payload = publicationPayload(source);
  expect(payload.ItemSpecifics).toEqual(source.ItemSpecifics);
  expect(payload.ProductListingDetails).toBeUndefined();
  source.ItemSpecifics.NameValueList[0].Value = ["Different brand"];
  expect(() => publicationPayload(source)).toThrow("Produktkennung");
});
