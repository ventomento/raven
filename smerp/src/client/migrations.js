/**
 * Older versions disabled a relay after 3 failures in a row, for good.
 * Sync now backs off instead and only the user sets disabled. Re-enable
 * relays that look disabled by sync (disabled with more than 2 failures)
 * so they get retried.
 */
export async function resetSyncDisabledRelays(directory) {

    const relays = await directory.relaysGet();

    for (const relay of relays) {

        if (!(relay.disabled && relay.failureCount > 2)) {
            continue;
        }

        await directory.put({ ...relay, disabled: false, failureCount: 0 });
    }
}

// Run at every start, before relays are loaded.
export async function runMigrations({ directory }) {
    await resetSyncDisabledRelays(directory);
}
