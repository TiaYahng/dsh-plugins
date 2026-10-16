# free-model/ — vendored

The browser half lives inside client.js between the VENDOR markers; this
directory is its server half. Both come from **dsh-our-free-model** (MIT), taken
as they are and patched only where the code believed it owned the machine:

| Where | What | Why |
| --- | --- | --- |
| server.js | API prefix → /api/comprehensive-platform/free-model | two plugins must not serve one prefix |
| server.js | distributionOf → always managed | its updater, announcement feed and hot reload rewrite the installed package, which is this plugin's bytes |
| server.js | version read from the parent package.json | there is no package.json of its own here |
| src/store.js | DATA_DIR_NAME → comprehensive-platform | two writers on one catalog corrupt it |

Everything under src/ and vendor/ is theirs, unmodified. vendor/channel-pack/ is
in turn a complete copy of a third-party upstream — see channel-pack/NOTICE.md,
which names it and its licence. The LICENSE next to this file is theirs.

