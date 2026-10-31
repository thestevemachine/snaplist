// Gemini supports numeric bounds; keep the shared Claude schema unchanged.
export function geminiOutputSchema(schema: unknown): any {
 if (!schema || typeof schema !== "object") return schema;
 if (Array.isArray(schema)) return schema.map(geminiOutputSchema);
 const out: any = Object.fromEntries(Object.entries(schema).map(([k,v])=>[k,geminiOutputSchema(v)]));
 if(out.type === "object" && out.properties?.x?.type === "number" && out.properties?.y?.type === "number") {
  for(const key of ["x","y"]) out.properties[key] = {...out.properties[key],minimum:0,maximum:1};
 }
 if(out.properties?.confidence) out.properties.confidence = {...out.properties.confidence,type:"integer",minimum:0,maximum:100,description:"Confidence percentage, integer 0 to 100. For example 98, never 0.98."};
 return out;
}

// The measure endpoint supplies exactly one image. Its index is known by the server.
export function singlePhotoGeometrySchema(geometry: any): any {
 return {...geometry,properties:{...geometry.properties,photoIndex:{type:"integer",enum:[1]}}};
}
