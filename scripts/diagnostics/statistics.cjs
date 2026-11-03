function median(values){
 if(!Array.isArray(values)||!values.length||values.some(value=>!Number.isFinite(value)))throw Error('Median requires finite observations');
 const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
 return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
module.exports={median};
