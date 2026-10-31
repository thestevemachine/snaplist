// Resolve known validation messages to existing controls; never guess a field value.
export function issueField(issue: string, aspectNames: string[]): string | undefined {
 const normalize=(value:string)=>" "+value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim()+" ";
 const text=normalize(issue);
 const aspect=[...aspectNames].sort((a,b)=>b.length-a.length).find(name=>text.includes(normalize(name)));
 if(aspect) return aspect;
 if(/foto|photo/i.test(issue)) return "Fotos";
 if(/sku/i.test(issue)) return "SKU";
 if(/titel|title/i.test(issue)) return "Titel";
 if(/preis|price/i.test(issue)) return "Preis";
 if(/beschreibung|description/i.test(issue)) return "Beschreibung";
 if(/zustand|condition/i.test(issue)) return "eBay-Zustand";
 if(/rahmenbedingungen|artikelstandort|shipping/i.test(issue)) return "Versand";
 if(/kategorie|category/i.test(issue)) return "Kategorie";
 return undefined;
}
export function focusReviewField(root: HTMLElement, field: string) {
 const element=[...root.querySelectorAll<HTMLElement>("[data-review-field]")].find(el=>el.dataset.reviewField===field);
 if(!element) return;
 for(let parent:HTMLElement|null=element;parent && root.contains(parent);parent=parent.parentElement)
  if(parent instanceof HTMLDetailsElement) parent.open=true;
 element.querySelectorAll<HTMLDetailsElement>("details.aspect-choices").forEach(el=>el.open=true);
 const control=element.matches("input,select,textarea,button") ? element : (element.querySelector<HTMLElement>("input:not(:disabled),select:not(:disabled),textarea:not(:disabled)") ?? element.querySelector<HTMLElement>("button:not(:disabled),summary"));
 requestAnimationFrame(()=>{
  (control || element).scrollIntoView({behavior:"smooth",block:"center"});
  control?.focus({preventScroll:true});
 });
}
