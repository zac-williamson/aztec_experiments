export const mainRules = ['Make room for disagreement. Critique ideas, not people.', 'Do not publish private personal information.', 'No spam, scams or threats.'];
export const boards = [
  {id:'commons', name:'The commons', icon:'◌', color:'mint', description:'A good place to start a conversation. Small observations, big questions, and everything between.', rules:['Keep opening posts relevant to community discussion.'], curated:true},
  {id:'building', name:'Building things', icon:'⌘', color:'lilac', description:'Show the rough edges. Share what you are making and build together with Bok.', rules:['Describe what you are building and give useful context.'], curated:true},
  {id:'ideas', name:'Unfinished ideas', icon:'✳', color:'peach', description:'A home for the questions you have not quite worked out yet.', rules:['Welcome questions and constructive uncertainty.'], curated:true},
  {id:'field-notes', name:'Field notes', icon:'⌁', color:'blue', description:'Interesting things noticed away from the screen.', rules:['Include context for observations.'], curated:false},
  {id:'open-data', name:'Open data', icon:'▦', color:'mint', description:'Explore public datasets and make them useful.', rules:['Cite the source of a dataset.'], curated:false},
  {id:'no-rules', name:'No rules', icon:'⊘', color:'peach', description:'Rejected subboard. Content is unavailable.', rules:[], rejected:true, reason:'The proposed local rules contradicted the main board policy on private personal information.', curated:false}
];
export const profiles = {
  'Ellis Moss': {initials:'EM', color:'blue', bio:'Learning by making. Sharing a few things along the way.'},
  'Mira Vale': {initials:'MV', color:'lilac', bio:'Making small tools for a more interesting internet.'},
  'Rowan Lake': {initials:'RL', color:'mint', bio:'Collecting questions. Sometimes finding answers.'},
  'Jules Reed': {initials:'JR', color:'peach', bio:'Cities, maps, and the spaces between.'},
  'Bok': {initials:'B', color:'blue', bio:'The community’s registered assistant. Build and explore together inside a thread.', bot:true}
};
export const ownNames = ['Mira Vale', 'Ellis Moss']; // Visible only in private account/composer previews.
export const posts = [
  {id:'first-tools', root:'first-tools', board:'building', author:'Mira Vale', text:'What would you build if the first version only had to work for ten people?\n\nI keep coming back to small, useful tools. A neighborhood lending library. A map of quiet places. Something that gives a little more than it asks.', likes:28, time:400, age:'24 min', replies:3, tag:'A question for builders'},
  {id:'quiet-map', root:'quiet-map', board:'commons', author:'Anonymous', text:'There is a bench near my apartment where nobody checks their phone. No sign, no rule. Just a very good tree.\n\nWhat is your city’s unofficial quiet place?', likes:19, time:390, age:'38 min', replies:1},
  {id:'public-gardens', root:'public-gardens', board:'ideas', author:'Jules Reed', text:'A public garden, but for ideas: leave one, take one, come back in a month to see what grew.\n\nCould a discussion space work that way?', likes:14, time:380, age:'1 hr', replies:0},
  {id:'r1', root:'first-tools', parent:'first-tools', board:'building', author:'Rowan Lake', text:'A map of drinking fountains that actually work. Start with one walking route and let people add a note when they pass.', likes:7, time:410, age:'18 min', replies:1},
  {id:'r2', root:'first-tools', parent:'r1', board:'building', author:'Mira Vale', text:'Bok, help us sketch the smallest useful version: a map, a fountain, and a last-checked date.', likes:3, time:420, age:'12 min', replies:1},
  {id:'r3', root:'first-tools', parent:'r2', board:'building', author:'Bok', text:'I would start with three views: nearby fountains, one fountain’s details, and a quick “still working” check. The thread workspace can hold the source as the idea develops.', likes:9, time:430, age:'8 min', replies:0, artifact:true},
  {id:'removed', root:'quiet-map', parent:'quiet-map', board:'commons', author:'Anonymous', text:'', removed:true, likes:0, time:440, age:'6 min', replies:1},
  {id:'after-removed', root:'quiet-map', parent:'removed', board:'commons', author:'Jules Reed', text:'Keeping the discussion about public places would be a better approach.', likes:2, time:450, age:'4 min', replies:0},
  ...Array.from({length:12}, (_, i) => ({id:`note-${i}`,root:`note-${i}`,board:['commons','ideas','building'][i%3],author:['Rowan Lake','Anonymous','Jules Reed'][i%3],text:[
    'A useful constraint for a weekend project: make one ordinary moment a little easier. What moment would you choose?',
    'What is something you changed your mind about recently? I would like to hear about the conversation that helped.',
    'Today’s small discovery: writing the question down clearly is often half of building the answer.'
  ][i%3],likes:12-i,time:370-i,age:`${i+2} hr`,replies:0}))
];
