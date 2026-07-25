var s={widgets:{notes:{mount(o,r){o.innerHTML=`
          <div style="height:100%;display:flex;flex-direction:column;">
            <textarea data-notes placeholder="Type your notes here - they autosave..."
              style="flex:1;resize:none;border:none;background:transparent;color:inherit;
                     padding:12px;font:inherit;font-size:.9rem;outline:none;"></textarea>
            <div data-status style="padding:4px 12px;font-size:.75rem;opacity:.55;height:22px;"></div>
          </div>`;let a=o.querySelector("[data-notes]"),t=o.querySelector("[data-status]"),i,e=!1;r.apiFetch("/content").then(n=>n.json()).then(n=>{e||(a.value=n.content)}).catch(()=>{e||(t.textContent="Failed to load notes")});let d=async()=>{t.textContent="Saving...";try{if(!(await r.apiFetch("/content",{method:"PUT",body:{content:a.value}})).ok)throw new Error;e||(t.textContent="Saved")}catch{e||(t.textContent="Save failed - will retry on next edit")}};return a.addEventListener("input",()=>{t.textContent="Typing...",clearTimeout(i),i=setTimeout(d,800)}),{unmount(){e=!0,clearTimeout(i)}}}}}},l=s;export{l as default};
