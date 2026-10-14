import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const parse = text => Object.fromEntries([...text.matchAll(/(--badge-(?:success|warning|danger|info)-(?:bg|fg)):\s*(#[a-f0-9]{6});/gi)].map(m=>[m[1],m[2]]));
const root = parse(css.split(":root {")[1].split("\n}")[0]);
function contrast(a,b) {
 const lum=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((a,c,i)=>a+c*[.2126,.7152,.0722][i],0);
 const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
test("badge text meets 4.5:1 WCAG AA in all supported themes",()=>{
 for (const theme of ["atelier","midnight","canopy"]){
   const vars = theme==="atelier"?root:{...root,...parse(css.split('[data-theme="'+theme+'"] {')[1].split("\n}")[0])};
   for(const status of ["success","warning","danger","info"]){
     const bg=vars["--badge-"+status+"-bg"],fg=vars["--badge-"+status+"-fg"];
     assert.ok(bg&&fg,theme+" "+status+" missing opaque tokens");
     assert.ok(contrast(bg,fg)>=4.5,theme+" "+status+" contrast "+contrast(bg,fg));
     assert.ok(css.includes("background: var(--badge-"+status+"-bg);"),"CSS must consume theme tokens");
   }
 }
});
