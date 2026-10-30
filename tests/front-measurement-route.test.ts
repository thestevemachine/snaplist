import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/ai/measure/route";
let fetchMock: ReturnType<typeof vi.fn>;
const lens = (l: number, r: number) => ({
  left: { x: l, y: 0.4 },
  right: { x: r, y: 0.4 },
  top: { x: (l + r) / 2, y: 0.2 },
  bottom: { x: (l + r) / 2, y: 0.6 },
});
function body() {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write("IHDR", 12);
  png.writeUInt32BE(1000, 16);
  png.writeUInt32BE(500, 20);
  return {
    confirmed: true,
    model: "gemini-3.5-flash-lite",
    photoIndex: 2,
    image: { mediaType: "image/png", data: png.toString("base64") },
    listing: {
      title: "Manueller Titel",
      description: "Manuell",
      eyewear: {
        fields: {
          lensWidth: {
            source: "label",
            value: "50",
            quote: "50□18 140",
            photos: [10],
          },
        },
        warnings: [],
      },
    },
  };
}
function request(b: unknown, auth = true) {
  return new NextRequest("https://test.example/api/ai/measure", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { "x-app-secret": "access" } : {}),
    },
    body: JSON.stringify(b),
  });
}
beforeEach(() => {
  vi.stubEnv("APP_SECRET", "access");
  vi.stubEnv("GEMINI_API_KEY", "fake-test-key");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("guards authentication, consent, model allowlist and missing reference before paying", async () => {
  expect((await POST(request(body(), false))).status).toBe(401);
  expect((await POST(request({ ...body(), confirmed: false }))).status).toBe(
    400,
  );
  expect((await POST(request({ ...body(), model: "unknown" }))).status).toBe(
    400,
  );
  const b = body();
  b.listing.eyewear.fields.lensWidth.value = "";
  expect((await POST(request(b))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("makes exactly one selected-photo call, returns calculated values and usage, and preserves the draft", async () => {
  const geometry = {
    photoIndex: 1,
    leftLens: lens(0.15, 0.4),
    rightLens: lens(0.6, 0.85),
    outerLeft: { x: 0.05, y: 0.4 },
    outerRight: { x: 0.95, y: 0.4 },
    frontal: false,
    groovesVisible: true,
    complete: true,
    samePlane: true,
    confidence: 90,
    note: "Leichte Perspektive",
  };
  fetchMock.mockResolvedValue(
    Response.json({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ front_geometry: geometry }) }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 300 },
    }),
  );
  const b = body();
  const original = structuredClone(b.listing);
  const data = await (await POST(request(b))).json();
  expect(data.ok).toBe(true);
  expect(data.measurement).toMatchObject({
    photoIndex: 2,
    lensHeightMm: 40,
    totalWidthMm: 180,
    status: "uncertain",
    referencePhotos: [10],
  });
  expect(b.listing).toEqual(original);
  expect(data.listing).toBeUndefined();
  expect(data.usage).toHaveLength(1);
  expect(data.usage[0].stage).toBe("front-measurement");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(sent.contents[0].parts.filter((p: any) => p.inlineData)).toHaveLength(
    1,
  );
});
it("does not retry malformed responses or provider failures and retains charged usage", async () => {
  fetchMock.mockResolvedValue(
    Response.json({
      candidates: [
        { content: { parts: [{ text: "bad-json" }] }, finishReason: "STOP" },
      ],
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 300 },
    }),
  );
  const data = await (await POST(request(body()))).json();
  expect(data.ok).toBe(false);
  expect(data.usage).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("uses a seller-confirmed 46 mm demo-lens reference without demanding an AI label quote",async()=>{
 const b=body();
 b.listing.eyewear.fields.lensWidth={value:"46",source:"manual"} as any;
 const geometry={photoIndex:1,leftLens:lens(.15,.4),rightLens:lens(.6,.85),outerLeft:{x:.05,y:.4},outerRight:{x:.95,y:.4},frontal:true,groovesVisible:true,complete:true,samePlane:true,confidence:95,note:""};
 fetchMock.mockResolvedValue(Response.json({candidates:[{content:{parts:[{text:JSON.stringify({front_geometry:geometry})}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20}}));
 const data=await (await POST(request(b))).json();
 expect(data.ok).toBe(true);
 expect(data.measurement).toMatchObject({referenceMm:46,referenceSource:"manual",lensHeightMm:37,totalWidthMm:166});
 expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects fabricated scale and mismatched quoted box dimensions without charging",async()=>{
 for(const quote of ["Bügelstand 50","Modell 50 CE","48 □ 18 140"]){
  const b=body();b.listing.eyewear.fields.lensWidth.quote=quote;
  const response=await POST(request(b));expect(response.status).toBe(400);
 }
 expect(fetchMock).not.toHaveBeenCalled();
});
it("allows an explicitly selected measurement photo without lens inscription and returns an independent caliper reading",async()=>{
 const b=body() as ReturnType<typeof body> & {measurementPhoto?:boolean};b.measurementPhoto=true;b.listing.eyewear.fields={} as typeof b.listing.eyewear.fields;
 const zero={x:0,y:0};
 fetchMock.mockResolvedValueOnce({ok:true,headers:new Headers(),json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({front_geometry:{photoIndex:0,leftLens:lens(0,0),rightLens:lens(0,0),outerLeft:zero,outerRight:zero,frontal:false,groovesVisible:false,complete:false,samePlane:false,confidence:0,note:"Messschieberfoto"},measurement_photos:[{dimension:"totalWidth",method:"caliper",photoIndex:1,reading:"144 mm",scaleMm:0,scaleStart:zero,scaleEnd:zero,start:zero,end:zero,readable:true,aligned:true,samePlane:true,confidence:95,note:"Beide Backen an äußeren Scharnieren"}]})}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:10}})});
 const response=await POST(request(b));const data=await response.json();expect(response.status).toBe(200);expect(data.ok).toBe(true);expect(data.measurementPhotos).toHaveLength(1);expect(data.measurementPhotos[0].photoIndex).toBe(2);expect(data.measurementPhotos[0].reading).toBe("144 mm");
});
