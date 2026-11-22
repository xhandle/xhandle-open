const colors = require('tailwindcss/colors');
const palette = require('./palette.json');
const neutral = ['slate', 'gray', 'zinc', 'neutral', 'stone'];
const status = {blue:'info',sky:'info',cyan:'info',indigo:'selected',violet:'selected',purple:'selected',fuchsia:'selected',green:'success',emerald:'success',teal:'success',lime:'success',yellow:'warning',amber:'warning',orange:'warning',red:'danger',rose:'danger',pink:'danger'};
const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value,16)).join(' ');
const color = name => `rgb(var(--x-${name}) / <alpha-value>)`;
const variables = {light:{},dark:{}}, backgroundColor={}, textColor={}, borderColor={};
function register(name, light, dark) {
  variables.light[`--x-${name}`]=rgb(light); variables.dark[`--x-${name}`]=rgb(dark);
  return color(name);
}
for(const [name,value] of Object.entries(palette.light)) {
  if(value.length===7)register(name,value,palette.dark[name]);
}
borderColor.DEFAULT=color('border');
backgroundColor.white=register('bg-white','#ffffff',palette.dark.surface);
for(const family of neutral) {
  backgroundColor[family]={};textColor[family]={};borderColor[family]={};
  for(const [shade,value] of Object.entries(colors[family])) {
    const n=Number(shade);
    const bg=n<=50?palette.dark.inset:n<=100?palette.dark.panel:n<=200?palette.dark.hover:n<=300?'#40536f':n<=500?'#455875':n<=700?'#293a52':n<=800?palette.dark.surface:palette.dark.canvas;
    backgroundColor[family][shade]=register(`bg-${family}-${shade}`,value,bg);
    textColor[family][shade]=register(`text-${family}-${shade}`,value,n>=700?palette.dark.text:n>=400?palette.dark.muted:value);
    borderColor[family][shade]=register(`border-${family}-${shade}`,value,n===300?palette.dark.controlBorder:n>=400&&n<=600?palette.dark.borderStrong:palette.dark.border);
  }
}
for(const [family,role] of Object.entries(status)) {
  backgroundColor[family]={};textColor[family]={};borderColor[family]={};
  for(const [shade,value] of Object.entries(colors[family])) {
    const n=Number(shade);
    if(n<=200)backgroundColor[family][shade]=register(`bg-${family}-${shade}`,value,palette.dark[role]);
    if(n>=400)textColor[family][shade]=register(`text-${family}-${shade}`,value,palette.dark[role==='selected'?'selectedText':`${role}Text`]);
    if(n<=300)borderColor[family][shade]=register(`border-${family}-${shade}`,value,palette.dark[role==='selected'?'focus':`${role}Text`]);
  }
}
// Saturated status colors still need readable white labels.
for(const [family,shade,value]of [['red',500,'#b91c1c'],['rose',500,'#be123c'],['green',500,'#15803d'],['green',600,'#15803d'],['emerald',500,'#047857'],['teal',500,'#0f766e'],['amber',500,'#92400e'],['orange',500,'#c2410c']]) {
  backgroundColor[family][shade]=register(`bg-${family}-${shade}`,colors[family][shade],value);
}
// Cover the complete action range, including hover/active shades. Retain the
// original light colors and SVG paint; only background utilities are remapped.
const actionFamilies={blue:'actionBlue',sky:'actionBlue',cyan:'actionBlue',indigo:'actionPurple',violet:'actionPurple',purple:'actionPurple',fuchsia:'actionPurple'};
const blend=(foreground,background,amount)=>'#'+foreground.slice(1).match(/../g).map((n,i)=>Math.round(parseInt(n,16)*amount+parseInt(background.slice(1+i*2,3+i*2),16)*(1-amount)).toString(16).padStart(2,'0')).join('');
for(const [family,role]of Object.entries(actionFamilies))for(const shade of [500,600,700,800,900,950]) {
  const base=palette.dark[role];
  const dark=shade===700?palette.dark[role+'Hover']:shade>=800?blend(base,palette.dark.canvas,shade===800 ? .85 : shade===900 ? .7 : .5):base;
  backgroundColor[family][shade]=register(`bg-${family}-${shade}`,colors[family][shade],dark);
}
module.exports={backgroundColor,textColor,borderColor,variables,palette};
