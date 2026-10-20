(function(root){
  'use strict';
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const zero=()=>({headTurn:0,headX:0,headY:0,bodyTurn:0,bodyY:0});
  const smooth=t=>t*t*t*(t*(t*6-15)+10);
  // Phrase-length head gestures. Speech onset interrupts an idle hold, so even
  // short utterances show movement; the face itself always stays rigid.
  class GentleMotion{
    constructor({random=Math.random}={}){this.random=random;this.pose=zero();this.from=zero();this.to=zero();this.start=null;this.end=0;this.next=0;this.enabled=true;this.intensity=1;this.wasSpeaking=false;this.direction=1;this.previewUntil=0;}
    setEnabled(enabled,now){this.enabled=enabled;this.wasSpeaking=false;if(!enabled)this.previewUntil=0;this.begin(now,zero(),900);}
    setIntensity(value,now){const next=clamp(Number(value)||1,.5,1.4),ratio=next/this.intensity;this.intensity=next;const target={...this.to};for(const k of ['headTurn','headX','headY'])target[k]*=ratio;this.begin(now,target,500);}
    preview(now){this.enabled=true;this.previewUntil=now+6000;this.wasSpeaking=true;this.gesture(now,true,true);}
    begin(now,target,duration){this.from={...this.pose};this.to=target;this.start=now;this.end=now+duration;}
    gesture(now,speaking,onset=false){
      const redirect=this.random();this.direction=onset?(redirect<.5?-1:1):(redirect<.8?-this.direction:this.direction);
      const sign=this.direction,quiet=(!onset&&this.random()<.18) ? .4 : 1,strength=(speaking?1:.1)*this.intensity*quiet;
      const minimum=onset ? .020 : .012,range=onset ? .008 : .016;
      this.begin(now,{headTurn:sign*(minimum+this.random()*range)*strength,headX:sign*(.8+this.random()*.9)*strength,headY:(this.random()-.25)*1.6*strength,bodyTurn:-sign*(.0001+this.random()*.00025),bodyY:(this.random()-.65)*.3},speaking?(onset?900:1250)+this.random()*650:2100+this.random()*1100);
    }
    update(now,{speaking=false,reduced=false}={}){
      const active=speaking||now<this.previewUntil;
      if(reduced){this.pose=zero();this.start=null;this.next=now+2000;this.wasSpeaking=false;return{...this.pose};}
      if(this.start!==null){const t=clamp((now-this.start)/(this.end-this.start)),s=smooth(t);for(const k of Object.keys(this.pose))this.pose[k]=this.from[k]+(this.to[k]-this.from[k])*s;if(t>=1){this.start=null;this.next=now+(active?250+this.random()*650:1200+this.random()*1800);}}
      if(this.enabled){
        if(active&&!this.wasSpeaking)this.gesture(now,true,true);
        else if(!active&&this.wasSpeaking)this.begin(now,zero(),1200);
        else if(this.start===null&&now>=this.next)this.gesture(now,active);
      }
      this.wasSpeaking=active;
      return{...this.pose};
    }
  }
  const api={GentleMotion,zero};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PortraitGentleMotion=api;
})(typeof globalThis!=='undefined'?globalThis:this);
