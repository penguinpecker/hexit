// Bundled by build.mjs into dist/avatars.js (IIFE) as window.HexitAvatars: the DiceBear avatars ship in the bundle, so they
// work offline (they were a jsDelivr import). index.html loads this file after boot.
import * as core from '@dicebear/core';
import * as bottts from '@dicebear/bottts';

(globalThis as Record<string, unknown>).HexitAvatars = { core, style: bottts };
