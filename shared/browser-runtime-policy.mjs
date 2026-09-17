import { z } from 'zod';

// CSP forbids runtime code generation. Use Zod's supported interpreter before
// SDK modules construct schemas; validation rules and errors remain unchanged.
z.config({ jitless: true });
