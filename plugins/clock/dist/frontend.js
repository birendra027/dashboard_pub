var l={widgets:{clock:{mount(t,o){let e=o.config.hour12===!0;t.innerHTML=`
          <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;">
            <div data-time style="font-size:2rem;font-weight:700;font-variant-numeric:tabular-nums;cursor:pointer;"
                 title="Click to toggle 12h / 24h"></div>
            <div data-date style="opacity:.6;font-size:.85rem;"></div>
          </div>`;let i=t.querySelector("[data-time]"),d=t.querySelector("[data-date]"),n=()=>{let r=new Date;i.textContent=r.toLocaleTimeString(void 0,{hour12:e}),d.textContent=r.toLocaleDateString(void 0,{weekday:"long",year:"numeric",month:"long",day:"numeric"})};i.addEventListener("click",()=>{e=!e,n(),o.saveConfig({hour12:e})}),n();let a=setInterval(n,1e3);return{unmount:()=>clearInterval(a)}}}}},c=l;export{c as default};
