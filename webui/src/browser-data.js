// Deletes every IndexedDB database of this origin, not only smerp's: the
// browser keeps IndexedDB per origin, so other sites are never touched.
//
// indexedDB.databases() lists them where the browser supports it; elsewhere
// only fallbackNames (the databases we know we created) can be deleted.
//
// Resolves { listed, deleted, blocked, failed } (arrays of names). A deletion
// another tab holds open is "blocked": the browser finishes it once that tab
// closes the database, so it is reported instead of waited for.
export async function deleteAllDatabases({ factory = globalThis.indexedDB, fallbackNames = [] } = {}) {

  const listed = typeof factory.databases === "function";

  const names = listed
    ? (await factory.databases()).map(database => database.name).filter(Boolean)
    : fallbackNames;

  const result = { listed, deleted: [], blocked: [], failed: [] };

  const outcomes = await Promise.all(names.map(name => deleteDatabase(factory, name)));

  names.forEach((name, i) => result[outcomes[i]].push(name));

  return result;
}

function deleteDatabase(factory, name) {

  return new Promise(resolve => {

    let request;

    try {
      request = factory.deleteDatabase(name);
    }
    catch {
      resolve("failed");
      return;
    }

    request.onsuccess = () => resolve("deleted");
    request.onerror = () => resolve("failed");
    request.onblocked = () => resolve("blocked");
  });
}
