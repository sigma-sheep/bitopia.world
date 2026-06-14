import { Buffer } from "buffer";

// Privy's transaction-signing path (and some web3 deps) reference Node's global
// `Buffer`, which the browser doesn't provide — without this, pressing Approve to
// withdraw throws "ReferenceError: Buffer is not defined". This module is
// imported first in main.tsx so the global exists before any app code evaluates.
globalThis.Buffer = globalThis.Buffer ?? Buffer;
