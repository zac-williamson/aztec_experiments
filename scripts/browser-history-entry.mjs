// Test-only bundle. No production debug exports or note insertion API.
import {checkScreeningHistory} from './screening-history-fixture.mjs';
import {openPXEStore} from '../shared/sdk-store.mjs';
globalThis.checkBrowserHistory=()=>checkScreeningHistory(()=>openPXEStore({
 l1ChainId:31337,rollupAddress:'0x'+'01'.repeat(20),accountAddress:'0x'+'02'.repeat(32),
 dataDirectory:'hosting-history-check'
}));
