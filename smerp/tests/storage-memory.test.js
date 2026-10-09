import test from "node:test";

import { StorageMemory } from "../src/storage/storage-memory.js";
import { storageContract } from "./helpers/storage-contract.js";

storageContract(test, () => new StorageMemory());
