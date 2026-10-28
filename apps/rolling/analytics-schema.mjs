// Public, fixed vocabulary. Never add user-, wallet-, post- or transaction-derived fields.
export const ANALYTICS_VERSION=1;
export const ANALYTICS_SOURCES=Object.freeze(['direct','search','x','reddit','telegram','discord','github','other']);
export const ANALYTICS_DEVICES=Object.freeze(['mobile','desktop']);
export const ANALYTICS_CAMPAIGNS=Object.freeze(['none','launch','community','newsletter','other']);
export const ANALYTICS_EVENTS=Object.freeze([
 'visit','engaged','active_seconds','feed_loaded','feed_failed','conversation_opened','board_opened',
 'account_open','wallet_connected','account_usable','payment_started','payment_confirmed','credit_received',
 'post_attempt','post_included','post_visible','first_post','reply_included','like_attempt','like_included',
 'bok_requested','bok_completed','action_failed','action_cancelled','client_error'
]);
export const ANALYTICS_DURATION_BUCKETS=Object.freeze(['none','le_1s','le_5s','le_15s','le_30s','le_60s','le_120s','le_300s','le_600s','gt_600s']);
export const ANALYTICS_DURATION_EVENTS=Object.freeze(['feed_loaded','account_usable','credit_received','post_included','post_visible','like_included','bok_completed']);
export const ANALYTICS_FUNNEL=Object.freeze(['visit','account_open','wallet_connected','payment_started','payment_confirmed','account_usable','first_post']);
export function durationBucket(ms){
 if(!Number.isFinite(ms)||ms<0)return 'none';
 for(const limit of [1,5,15,30,60,120,300,600])if(ms<=limit*1000)return 'le_'+limit+'s';
 return 'gt_600s';
}
