/* Independent recovery client: no imports from the application, readonly IDB only. */
"use strict";
(() => {
  const by = id => document.getElementById(id), status = text => { by("status").textContent = text; };
  const canonical = x => Array.isArray(x) ? "[" + x.map(canonical).join(",") + "]" : x !== null && typeof x === "object" ? "{" + Object.keys(x).sort().map(k => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}" : JSON.stringify(x);
  const hash = async x => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(x))))].map(x => x.toString(16).padStart(2,"0")).join("");
  let selected = "";
  const show = (text, message) => { selected = text; by("content").textContent = text; by("download").hidden = false; status(message); };
  by("download").onclick = () => { const u = URL.createObjectURL(new Blob([selected], {type:"application/json"})), a = document.createElement("a"); a.href = u; a.download = "KATUSHKA-independent-recovery.json"; a.click(); setTimeout(() => URL.revokeObjectURL(u),30000); };
  by("file").onchange = async event => { try { const file = event.target.files[0]; if (!file || file.size > 64*1024*1024) throw Error("Файл отсутствует или больше 64 МиБ"); const text = await file.text(), v = JSON.parse(text); if (v.format !== "katushka-personal-backup" || v.version !== 1 || v.integrity?.algorithm !== "SHA-256-canonical-json-v1" || await hash({ format:v.format,version:v.version,exportedAt:v.exportedAt,data:v.data }) !== v.integrity.value) throw Error("Формат или контрольная сумма не подтверждены"); show(text,"Контрольная сумма полной копии подтверждена. Это чтение; восстановление не выполнялось."); } catch(e) { status(e.message); } };
  const expected = location.pathname.startsWith("/katushka-lab/") ? "katushka.lab.personal-core.v1" : location.pathname.startsWith("/katushka-pwa-mirror/") ? "katushka.mirror.katushka-pwa-mirror.personal-core.v1" : "katushka.local.personal-core.v1";
  by("open").onclick = async () => {
    try {
      if (!indexedDB.databases) throw Error("Браузер не предоставляет безопасную проверку существующей базы. Выберите ранее скачанную копию; новая база не создавалась.");
      if (!(await indexedDB.databases()).some(x => x.name === expected)) throw Error("Личная база на этом адресе отсутствует. Другие базы не открывались.");
      const db = await new Promise((resolve,reject) => { const q = indexedDB.open(expected); q.onupgradeneeded = () => { q.transaction.abort(); reject(Error("База отсутствует")); }; q.onerror = () => reject(q.error); q.onsuccess = () => resolve(q.result); });
      const read = (store,key) => new Promise((resolve,reject) => { const tx = db.transaction(store,"readonly"), q = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key); tx.oncomplete = () => resolve(q.result); tx.onabort = tx.onerror = () => reject(Error("Ошибка чтения")); });
      const generations = await read("generations"), active = await read("meta","active"), rows = await read("records"); db.close(); by("generations").replaceChildren();
      for (const g of generations) { const li = document.createElement("li"), button = document.createElement("button"); button.textContent = (g.id === active ? "Текущее: " : "Архив: ") + g.label + " · " + g.createdAt; li.append(button); const rawButton = document.createElement("button"); rawButton.textContent = "Исходные строки · " + g.label; rawButton.onclick = () => { const prefix = expected + ".input.v1." + g.id + ".", input = []; for (let i=0;i<localStorage.length;i++) { const key=localStorage.key(i); if(key?.startsWith(prefix)) input.push([key,localStorage.getItem(key)]); } show(JSON.stringify({format:"katushka-core-raw-diagnostic",version:1,generation:g,rows:rows.filter(r=>r.generation===g.id),input}),"Исходная диагностика без проверки или изменения записей. Это аварийная копия, а не автоматическое восстановление."); }; li.append(rawButton); by("generations").append(li);
        button.onclick = async () => { try {
          const d = {version:1,datasetId:g.datasetId,histories:[],historyRevision:g.historyRevision,partialHistories:g.partialHistories,workshop:{version:1,revision:g.workshopRevision,ideas:[],windings:[],additions:[],projects:[],editorDrafts:[]},events:{version:1,revision:g.eventsRevision,events:[],drafts:[]},cards:{version:1,revision:g.cardsRevision,cards:[],drafts:[]},links:[],windingDrafts:[],reserves:[],quarantine:[],snapshots:[],tombstones:[]};
          for (const r of rows.filter(r => r.generation === g.id).sort((a,b) => a.position-b.position)) { const parts = r.kind.split("."); const collection = parts.length === 1 ? d[parts[0]] : d[parts[0]]?.[parts[1]]; if (!Array.isArray(collection)) throw Error("Неизвестная структура строк. Не меняйте базу."); collection.push(r.value); }
          const reserves = new Map(d.reserves.map(x => [x.key,x]));
          const prefix = expected + ".input.v1." + g.id + ".";
          for (let i=0;i<localStorage.length;i++) { const k = localStorage.key(i); if (!k?.startsWith(prefix)) continue; const key = decodeURIComponent(k.slice(prefix.length)), raw = localStorage.getItem(k), domain=key.split(":")[0]; if (!["winding","events","cards","workshop"].includes(domain)) continue; reserves.set(key,{key,domain,raw:raw === "__KATUSHKA_INPUT_REMOVED_V1__" ? null : raw}); }
          d.reserves=[...reserves.values()]; const drafts = new Map(d.windingDrafts.map(x=>[x.slot,x])); for (const r of d.reserves) { if (r.domain === "winding" && r.raw !== null) (() => { try { const record=JSON.parse(r.raw); if(record.format === "katushka-winding-draft" && record.version === 1) drafts.set(r.key.slice(8),{slot:r.key.slice(8),record}); } catch { /* raw retained */ } })(); } d.windingDrafts=[...drafts.values()];
          const payload={format:"katushka-personal-backup",version:1,exportedAt:new Date().toISOString(),data:d};
          show(JSON.stringify({...payload,integrity:{algorithm:"SHA-256-canonical-json-v1",value:await hash(payload)}}), `Историй: ${d.histories.length}; событий: ${d.events.events.length}; визиток: ${d.cards.cards.length}; карантин: ${d.quarantine.length}. Сверьте копию в основном интерфейсе перед восстановлением.`);
        } catch(e) { show(JSON.stringify({format:"katushka-core-raw-diagnostic",version:1,generation:g,rows:rows.filter(r=>r.generation===g.id)}),"Выдана исходная диагностика, а не проверенная полная копия: " + e.message); } };
      } status("Найдены сохранённые поколения. Выберите одно для независимого чтения.");
    } catch(e) { status(e.message); }
  };
})();
