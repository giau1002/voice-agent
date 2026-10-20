(function(root){
  'use strict';
  const clamp=(x,min=0,max=1)=>Math.max(min,Math.min(max,x));
  class BlinkController{
    constructor({min=4000,max=8000,duration=190,random=Math.random}={}){this.min=min;this.max=max;this.duration=duration;this.random=random;this.enabled=true;this.next=null;this.started=null;}
    schedule(now){this.next=now+this.min+this.random()*(this.max-this.min);}
    trigger(now){this.started=now;this.schedule(now+this.duration);}
    configure(min,max,now){this.min=min;this.max=max;this.schedule(now);}
    setEnabled(value,now){this.enabled=value;this.schedule(now);}
    update(now){if(this.next===null)this.schedule(now);if(this.started===null&&this.enabled&&now>=this.next)this.trigger(now);if(this.started===null)return 0;const t=(now-this.started)/this.duration;if(t>=1){this.started=null;return 0;}if(t<.36)return Math.sin(clamp(t/.36)*Math.PI/2);if(t<.53)return 1;return Math.cos(clamp((t-.53)/.47)*Math.PI/2);}
  }
  function microphoneLevel(samples){if(!samples?.length)return 0;let sum=0;for(const x of samples)sum+=((x-128)/128)**2;const rms=Math.sqrt(sum/samples.length);return clamp((rms-.018)*9);}
  function smoothLevel(value,target,dt){return value+(target-value)*(1-Math.exp(-Math.max(0,dt)/(target>value?.11:.16)));}
  const shapes=['rest','MBP','AA','EE','OH','OO','FV','TDL','smile'];
  const pose=name=>Object.fromEntries(shapes.map(s=>[s,s===name?1:0]));
  function blend(a,b,t){return Object.fromEntries(shapes.map(s=>[s,(a[s]||0)*(1-t)+(b[s]||0)*t]));}
  function smoothPose(a,b,dt){return blend(a,b,1-Math.exp(-Math.max(0,dt)/.105));}
  const english={hello:['TDL','EE','TDL','OH'],my:['MBP','AA','EE'],mouth:['MBP','AA','OO','TDL'],moves:['MBP','OO','FV','TDL'],you:['EE','OO'],what:['OO','AA','TDL'],would:['OO','OO','TDL'],like:['TDL','AA','EE','TDL'],me:['MBP','EE'],say:['TDL','EE'],the:['TDL','EE'],this:['TDL','EE','TDL'],is:['EE','TDL'],a:['AA'],and:['AA','TDL'],i:['AA','EE'],speak:['TDL','MBP','EE','TDL']};
  // Text-derived articulation, not acoustic phoneme recognition. Preserve vowel quality; remove Vietnamese tones only.
  function wordPlan(word,lang='vi-VN'){
    const text=word.toLowerCase().normalize('NFD').replace(/[\u0300\u0301\u0303\u0309\u0323]/g,'').normalize('NFC');
    let result=[];if(lang.startsWith('en')&&english[text])result=english[text].slice();
    else for(let i=0;i<text.length;i++){
      const c=text[i],pair=text.slice(i,i+2);let name;
      if(['ph','th','ch','tr','sh','ng','nh'].includes(pair)){name=pair==='ph'?'FV':'TDL';i++;}
      else if(/[mbp]/.test(c))name='MBP';else if(/[fv]/.test(c))name='FV';
      else if(/[aăâ]/.test(c))name='AA';else if(/[eêiyư]/.test(c))name='EE';
      else if(/[oô]/.test(c))name='OH';else if(/[uw]/.test(c))name='OO';else if(c==='ơ')name='AA';
      else if(/[tdđlnszxcr]/.test(c))name='TDL';
      if(name&&name!==result.at(-1))result.push(name);
    }
    if(!result.length)result=['AA'];
    return result.map(name=>({name,weight:['AA','EE','OH','OO'].includes(name)?3.2:name==='MBP'?1.2:.8}));
  }
  function tokenize(text,lang,rate){const list=[...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];return list.map((m,i)=>{const plan=wordPlan(m[0],lang),gap=text.slice(m.index+m[0].length,list[i+1]?.index??text.length);const syllables=lang.startsWith('vi')?1:Math.max(1,(m[0].match(/[aeiouy]+/gi)||[]).length);return{text:m[0],start:m.index,end:m.index+m[0].length,plan,duration:(lang.startsWith('vi')?300:240+syllables*85)/rate,pause:/[.!?…]/.test(gap)?300/rate:/[,;:]/.test(gap)?160/rate:0};});}
  class SpeechPlanner{
    start(text,lang,now,rate=1){this.tokens=tokenize(text,lang,rate);this.started=now;this.anchor=null;this.boundaries=[];this.scale=1;this.total=this.tokens.reduce((s,t)=>s+t.duration+t.pause,0);return this;}
    boundary(charIndex,now,name){if(name!=='word'||!Number.isInteger(charIndex))return false;const index=this.tokens.findIndex(t=>charIndex>=t.start&&charIndex<t.end);if(index<0||this.anchor&&index<this.anchor.index)return false;if(this.anchor&&index===this.anchor.index)return false;
      if(this.anchor){let expected=0;for(let i=this.anchor.index;i<index;i++)expected+=this.tokens[i].duration+this.tokens[i].pause;const measured=(now-this.anchor.at)/expected;if(measured>.3&&measured<3)this.scale=this.scale*.55+measured*.45;}
      this.anchor={index,at:now,scale:this.scale};this.boundaries.push(this.anchor);return true;
    }
    sample(now){if(!this.tokens?.length||now<this.started)return{weights:pose('rest'),index:-1,word:'',source:'estimated',viseme:'rest'};const anchor=this.boundaries.findLast(b=>b.at<=now),scale=anchor?.scale??1;let index=anchor?.index??0,elapsed=Math.max(0,now-(anchor?.at??this.started)),source=anchor?'boundary':'estimated';
      // Some voices emit one boundary and then stop. Resume estimated motion
      // after the expected word/pause plus a short grace, rather than freezing.
      const anchorSpan=(this.tokens[index].duration+this.tokens[index].pause)*scale;
      const grace=Math.max(100,Math.min(240,this.tokens[index].duration*scale*.35));
      const stale=anchor&&elapsed>anchorSpan+grace;
      if(stale)source='estimated';
      if(!anchor||stale){while(index<this.tokens.length){const t=this.tokens[index],span=(t.duration+t.pause)*scale;if(elapsed<span)break;elapsed-=span;index++;}}
      if(index>=this.tokens.length)return{weights:pose('rest'),index:-1,word:'',source,viseme:'rest'};
      const token=this.tokens[index],duration=token.duration*scale,progress=clamp(elapsed/duration);
      if(elapsed>=duration&&(token.pause||elapsed>duration+180))return{weights:pose('rest'),index,word:token.text,source,viseme:'rest'};
      const total=token.plan.reduce((s,p)=>s+p.weight,0),point=clamp(progress,0,.9999)*total;let sum=0,k=0;
      for(;k<token.plan.length-1;k++){if(point<sum+token.plan[k].weight)break;sum+=token.plan[k].weight;}
      const current=token.plan[k],local=(point-sum)/current.weight;let weights=pose(current.name);
      // Hold this word's final articulation. Do not preview the next word before its timestamp.
      const next=token.plan[k+1]?.name;
      if(next&&local>.82){const t=clamp((local-.82)/.18);weights=blend(weights,pose(next),t*t*(3-2*t));}
      // A syllable has a gentle opening/relaxing envelope even when its vowel
      // stays the same. This is text estimated articulation, not audio analysis.
      const articulation=.78+.22*Math.sin(Math.PI*progress)**2;
      return{weights,index,word:token.text,source,articulation,viseme:shapes.reduce((a,b)=>weights[b]>weights[a]?b:a,'rest')};
    }
  }
  const api={clamp,BlinkController,microphoneLevel,smoothLevel,shapes,pose,blend,smoothPose,wordPlan,tokenize,SpeechPlanner};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PortraitCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
