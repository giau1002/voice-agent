(function(root){
  'use strict';
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const ease=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
  function characterPose(m={}){return[clamp(m.headTurn||0,-.040,.040),clamp(m.headX||0,-2.4,2.4),clamp(m.headY||0,-1.7,1.7),clamp(m.bodyTurn||0,-.0007,.0007),clamp(m.bodyY||0,-.4,.4)];}
  function inverseCharacter(x,y,v,trig=[Math.cos(v[0]),Math.sin(v[0]),Math.cos(v[3]),Math.sin(v[3])]){
    let px=x,py=y;
    for(let i=0;i<5;i++){
      const hw=1-ease(255,315,py),bw=1-ease(520,700,py),[c,s,bc,bs]=trig;
      const hx=px+hw*((c-1)*(px-284)-s*(py-275)+v[1]),hy=py+hw*(s*(px-284)+(c-1)*(py-275)+v[2]);
      const fx=hx+bw*((bc-1)*(hx-280)-bs*(hy-610)),fy=hy+bw*(bs*(hx-280)+(bc-1)*(hy-610)+v[4]);
      px=x-(fx-px);py=y-(fy-py);
    }
    return[px,py];
  }
  // Continuous controls, without dominant-pose selection or frame swapping.
  function controls(w,blink){
    const opening=.95*clamp((w.AA||0)+(w.EE||0)*.38+(w.OH||0)*.72+(w.OO||0)*.48+(w.FV||0)*.22+(w.TDL||0)*.45+(w.smile||0)*.2);
    const width=clamp((w.EE||0)*.025-(w.OH||0)*.025-(w.OO||0)*.035+(w.smile||0)*.015,-.035,.025);
    return[opening,width,clamp(w.smile||0)*.7,0,clamp(blink)];
  }
  const vertex=`#version 300 es
    in vec2 position;out vec2 uv;
    void main(){gl_Position=vec4(position,0.,1.);uv=vec2(position.x*.5+.5,.5-position.y*.5);}`;
  const fragment=`#version 300 es
    precision highp float;
    in vec2 uv;out vec4 pixel;
    uniform sampler2D photo,colors,flows,mouths,layer;
    uniform vec2 size,center,mouthCenter;
    uniform vec4 mouthRect;
    uniform float amounts[5];
    uniform vec4 characterPose;
    uniform float bodyY;
    uniform bool transparentBackground;
    vec2 safeUV(vec2 p){return clamp(p,.5/size,1.-.5/size);}
    vec3 cell(sampler2D image,vec2 p,int index){return texture(image,(safeUV(p)+vec2(float(index%3),float(index/3)))/vec2(3.,2.)).rgb;}
    vec3 field(vec2 p,int index){vec3 f=cell(flows,p,index);return vec3((f.rg*255.-128.)*24./127./size,f.b);}
    vec3 mouthFrame(vec2 p,float index){
      vec2 local=clamp((p*size-mouthRect.xy)/mouthRect.zw,.5/mouthRect.zw,1.-.5/mouthRect.zw);
      return texture(mouths,(local+vec2(mod(index,4.),floor(index/4.)))/vec2(4.,3.)).rgb;
    }
    vec3 portrait(vec2 q){
      vec2 p=q;
      if(abs(q.x-center.x)>.14||q.y<center.y-.05||q.y>center.y+.15)return texture(photo,safeUV(q)).rgb;
      // Only blinking uses an image displacement field. Mouth states follow
      // one ordered opening trajectory: incompatible mouth fields never sum.
      if(amounts[4]>.0001)for(int j=0;j<3;j++)p=q-amounts[4]*field(p,4).xy;
      vec3 result=texture(photo,safeUV(p)).rgb;
      if(amounts[4]>.0001){vec3 f=field(p,4);result=mix(result,cell(colors,p+f.xy,5),amounts[4]*f.z);}
      float jawRadius=q.y>mouthCenter.y?.050:.032;
      float mask=1.-smoothstep(.7,1.,length((q-mouthCenter)/vec2(.072,jawRadius)));
      if(mask>0.){
        vec2 articulation=q;
        articulation.x=mouthCenter.x+(q.x-mouthCenter.x)/(1.+amounts[1]);
        float corner=clamp(abs(q.x-mouthCenter.x)/.043,0.,1.);
        articulation.y+=amounts[2]*.7/size.y*corner*corner;
        float frame=clamp(amounts[0],0.,1.)*10.,first=floor(frame);
        vec3 mouth=mix(mouthFrame(articulation,first),mouthFrame(articulation,min(first+1.,10.)),fract(frame));
        result=mix(result,mouth,mask);
      }
      return result;
    }
    vec2 inverseCharacter(vec2 q){
      vec2 p=q;
      for(int i=0;i<5;i++){
        float hw=1.-smoothstep(255.,315.,p.y),bw=1.-smoothstep(520.,700.,p.y);
        float c=cos(characterPose.x),s=sin(characterPose.x),bc=cos(characterPose.w),bs=sin(characterPose.w);
        vec2 r=p-vec2(284.,275.);
        vec2 h=p+hw*(vec2(c*r.x-s*r.y,s*r.x+c*r.y)-r+characterPose.yz);
        vec2 b=h-vec2(280.,610.);
        vec2 f=h+bw*(vec2(bc*b.x-bs*b.y,bs*b.x+bc*b.y)-b+vec2(0.,bodyY));
        p=q-(f-p);
      }
      return p/size;
    }
    vec3 background(vec2 q){
      vec2 offset=(texture(layer,safeUV(q)).rg*255.-128.)*24./127./size;
      return texture(photo,safeUV(q+offset)).rgb;
    }
    void main(){
      if(transparentBackground){
        vec2 p=inverseCharacter(uv*size);
        pixel=vec4(clamp(portrait(p),0.,1.),texture(layer,safeUV(p)).b);return;
      }
      if(dot(abs(characterPose),vec4(1.))+abs(bodyY)<.000001){pixel=vec4(clamp(portrait(uv),0.,1.),1.);return;}
      vec2 p=inverseCharacter(uv*size);
      float alpha=texture(layer,safeUV(p)).b,originalAlpha=texture(layer,safeUV(uv)).b;
      if(alpha<.00001&&originalAlpha<.00001){pixel=vec4(texture(photo,safeUV(uv)).rgb,1.);return;}
      vec3 result=background(uv);
      if(alpha>.00001){
        // Unmatting keeps the source edge intact at zero movement. The static
        // office is restored only in the few pixels uncovered at the silhouette.
        result=(1.-alpha)*result+portrait(p)-(1.-alpha)*background(p);
      }
      pixel=vec4(clamp(result,0.,1.),1.);
    }`;
  // The same equations in JS provide a CPU fallback and frame-level QA.
  class SoftwareRig{
    constructor(canvas,images,meta,createCanvas,transparentBackground=false){
      this.canvas=canvas;this.ctx=canvas.getContext('2d');this.meta=meta;
      this.images=images.map(image=>{const c=createCanvas(image.width,image.height),x=c.getContext('2d');x.drawImage(image,0,0);return{width:c.width,height:c.height,data:x.getImageData(0,0,c.width,c.height).data};});
      this.output=this.ctx.createImageData(canvas.width,canvas.height);
      [this.photo,this.color,this.flow,this.mouth,this.layer]=this.images;this.sampled=new Float64Array(3);this.f=new Float64Array(3);this.temp=new Float64Array(3);this.animated=this.ctx.createImageData(canvas.width,canvas.height);
      this.ctx.drawImage(images[0],0,0,canvas.width,canvas.height);this.original=this.ctx.getImageData(0,0,canvas.width,canvas.height).data;
      this.transparentBackground=transparentBackground&&!!this.layer;
      if(this.transparentBackground)for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        this.sample(this.layer,(x+.5)/canvas.width,(y+.5)/canvas.height,this.sampled);this.original[(y*canvas.width+x)*4+3]=Math.round(this.sampled[2]);
      }
      if(this.layer){const {width:w,height:h}=canvas,m=this.meta;this.motionRows=[];
        const margin=Math.ceil(16/m.width*w);
        for(let y=0;y<h;y++){let lo=w,hi=0;const sy=Math.floor((y+.5)/h*m.height);for(let yy=Math.max(0,sy-10);yy<=Math.min(m.height-1,sy+10);yy++)for(let xx=0;xx<m.width;xx++)if(this.layer.data[(yy*m.width+xx)*4+2]>0){lo=Math.min(lo,Math.floor(xx/m.width*w)-margin);hi=Math.max(hi,Math.ceil((xx+1)/m.width*w)+margin);}this.motionRows.push([Math.max(0,lo),Math.min(w,hi)]);}
      }
    }
    sample(image,u,v,out){
      const x=clamp(u*image.width-.5,0,image.width-1),y=clamp(v*image.height-.5,0,image.height-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,image.width-1),y1=Math.min(y0+1,image.height-1),fx=x-x0,fy=y-y0,d=image.data;
      const a=(y0*image.width+x0)*4,b=(y0*image.width+x1)*4,c=(y1*image.width+x0)*4,e=(y1*image.width+x1)*4;
      for(let k=0;k<3;k++)out[k]=(d[a+k]*(1-fx)+d[b+k]*fx)*(1-fy)+(d[c+k]*(1-fx)+d[e+k]*fx)*fy;
      return out;
    }
    cell(image,u,v,index,out){const m=this.meta;return this.sample(image,(clamp(u,.5/m.width,1-.5/m.width)+index%3)/3,(clamp(v,.5/m.height,1-.5/m.height)+Math.floor(index/3))/2,out);}
    field(u,v,index,out){this.cell(this.flow,u,v,index,out);out[0]=(out[0]-128)*24/127/this.meta.width;out[1]=(out[1]-128)*24/127/this.meta.height;out[2]/=255;return out;}
    mouthFrame(u,v,index,out){const r=this.meta.mouth_sequence.rect;return this.sample(this.mouth,(clamp((u*this.meta.width-r[0])/r[2],.5/r[2],1-.5/r[2])+index%4)/4,(clamp((v*this.meta.height-r[1])/r[3],.5/r[3],1-.5/r[3])+Math.floor(index/4))/3,out);}
    render(amounts,motion={}){
      const {width:w,height:h}=this.canvas,m=this.meta,cx=(m.eyes[0][0]+m.eyes[1][0])/2,cy=(m.eyes[0][1]+m.eyes[1][1])/2,out=this.output.data;
      out.set(this.original);
      const x0=Math.max(0,Math.floor((cx-.14)*w)),x1=Math.min(w,Math.ceil((cx+.14)*w));
      const y0=Math.max(0,Math.floor((cy-.05)*h)),y1=Math.min(h,Math.ceil((cy+.15)*h));
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
        let qx=(x+.5)/w,qy=(y+.5)/h;
        let u=qx,v=qy;
        const face=Math.abs(qx-cx)<.14&&qy>cy-.05&&qy<cy+.15;
        if(face&&amounts[4]>.0001)for(let j=0;j<3;j++){this.field(u,v,4,this.f);u=qx-amounts[4]*this.f[0];v=qy-amounts[4]*this.f[1];}
        this.sample(this.photo,clamp(u,.5/m.width,1-.5/m.width),clamp(v,.5/m.height,1-.5/m.height),this.sampled);
        let red=this.sampled[0],green=this.sampled[1],blue=this.sampled[2];
        if(face&&amounts[4]>.0001){this.field(u,v,4,this.f);const dx=this.f[0],dy=this.f[1],alpha=amounts[4]*this.f[2];if(alpha>.0001){this.cell(this.color,u+dx,v+dy,5,this.sampled);red+=alpha*(this.sampled[0]-red);green+=alpha*(this.sampled[1]-green);blue+=alpha*(this.sampled[2]-blue);}}
        if(face){const mc=m.mouth,jawRadius=qy>mc[1]?.050:.032,r=Math.hypot((qx-mc[0])/.072,(qy-mc[1])/jawRadius),t=clamp((r-.7)/.3),mask=1-t*t*(3-2*t);
          if(mask>0){const mu=mc[0]+(qx-mc[0])/(1+amounts[1]),corner=clamp(Math.abs(qx-mc[0])/.043),mv=qy+amounts[2]*.7/m.height*corner*corner,frame=clamp(amounts[0])*10,first=Math.floor(frame),mix=frame-first;
            this.mouthFrame(mu,mv,first,this.temp);this.mouthFrame(mu,mv,Math.min(first+1,10),this.sampled);
            red+=mask*(this.temp[0]*(1-mix)+this.sampled[0]*mix-red);green+=mask*(this.temp[1]*(1-mix)+this.sampled[1]*mix-green);blue+=mask*(this.temp[2]*(1-mix)+this.sampled[2]*mix-blue);
          }
        }
        const k=(y*w+x)*4;out[k]=clamp(red,0,255);out[k+1]=clamp(green,0,255);out[k+2]=clamp(blue,0,255);
      }
      const pose=characterPose(motion);
      if(this.layer&&pose.some(v=>Math.abs(v)>.000001)){
        const animated=this.animated.data;animated.set(out);
        const source={width:w,height:h,data:out},sample=new Float64Array(3),bg=new Float64Array(3),lookup=new Float64Array(3),base=new Float64Array(3);
        const trig=[Math.cos(pose[0]),Math.sin(pose[0]),Math.cos(pose[3]),Math.sin(pose[3])];
        const background=(u,v,result)=>{this.sample(this.layer,u,v,lookup);return this.sample(this.photo,clamp(u+(lookup[0]-128)*24/127/m.width,.5/m.width,1-.5/m.width),clamp(v+(lookup[1]-128)*24/127/m.height,.5/m.height,1-.5/m.height),result);};
        for(let y=0;y<h;y++)for(let x=this.motionRows[y][0];x<this.motionRows[y][1];x++){
          const u=(x+.5)/w,v=(y+.5)/h,k=(y*w+x)*4,p=inverseCharacter(u*m.width,v*m.height,pose,trig),pu=p[0]/m.width,pv=p[1]/m.height;
          this.sample(this.layer,pu,pv,sample);const alpha=sample[2]/255;this.sample(this.layer,u,v,sample);if(alpha<.00001&&sample[2]<.00255)continue;
          if(this.transparentBackground){this.sample(source,pu,pv,sample);for(let c=0;c<3;c++)animated[k+c]=sample[c];animated[k+3]=Math.round(alpha*255);continue;}
          if(alpha>=.99999){this.sample(source,pu,pv,sample);for(let c=0;c<3;c++)animated[k+c]=sample[c];continue;}
          background(u,v,base);
          if(alpha>.00001){background(pu,pv,bg);this.sample(source,pu,pv,sample);for(let c=0;c<3;c++)animated[k+c]=clamp((1-alpha)*base[c]+sample[c]-(1-alpha)*bg[c],0,255);}
          else for(let c=0;c<3;c++)animated[k+c]=base[c];
        }
        this.ctx.putImageData(this.animated,0,0);
      }else this.ctx.putImageData(this.output,0,0);
    }
  }
  class PortraitRenderer{
    constructor(canvas,portrait,{motionAtlas,flowAtlas,mouthAtlas,characterLayer,metadata=root.PortraitRig,createCanvas,forceSoftware=false,transparentBackground=false}={}){
      if(!metadata?.mouth_sequence||!motionAtlas||!flowAtlas||!mouthAtlas)throw Error('Thiếu dữ liệu chuyển động nhân vật.');
      this.canvas=canvas;this.meta=metadata;this.lastKey='';this.createCanvas=createCanvas||((w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;});
      let gl=null;try{if(!forceSoftware)gl=canvas.getContext('webgl2',{alpha:transparentBackground&&!!characterLayer,premultipliedAlpha:false,antialias:false,depth:false,preserveDrawingBuffer:false});}catch{}
      this.gl=gl;this.engine=gl?'webgl2':'software';
      if(!gl){if(!forceSoftware){canvas.width=280;canvas.height=350;}this.software=new SoftwareRig(canvas,[portrait,motionAtlas,flowAtlas,mouthAtlas,...(characterLayer?[characterLayer]:[])],metadata,this.createCanvas,transparentBackground);return;}
      const compile=(type,code)=>{const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
      const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);this.program=program;
      const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      [portrait,motionAtlas,flowAtlas,mouthAtlas,characterLayer||portrait].forEach((image,index)=>{const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);gl.uniform1i(gl.getUniformLocation(program,['photo','colors','flows','mouths','layer'][index]),index);});
      this.hasCharacterLayer=!!characterLayer;this.characterPose=gl.getUniformLocation(program,'characterPose');this.bodyY=gl.getUniformLocation(program,'bodyY');
      gl.uniform1i(gl.getUniformLocation(program,'transparentBackground'),transparentBackground&&!!characterLayer?1:0);
      this.amounts=gl.getUniformLocation(program,'amounts[0]');gl.uniform2f(gl.getUniformLocation(program,'size'),metadata.width,metadata.height);gl.uniform2f(gl.getUniformLocation(program,'center'),(metadata.eyes[0][0]+metadata.eyes[1][0])/2,(metadata.eyes[0][1]+metadata.eyes[1][1])/2);
      gl.uniform2f(gl.getUniformLocation(program,'mouthCenter'),...metadata.mouth);gl.uniform4f(gl.getUniformLocation(program,'mouthRect'),...metadata.mouth_sequence.rect);
      canvas.addEventListener?.('webglcontextlost',event=>{event.preventDefault();this.lost=true;});canvas.addEventListener?.('webglcontextrestored',()=>location.reload());
    }
    render(weights={rest:1},blink=0,debug=false,force=false,motion={}){
      if(typeof weights==='number')weights={rest:1-weights,AA:weights};const values=controls(weights,blink);
      values[0]=clamp(values[0]*(motion.jawDepth??1)*(motion.articulation??1));
      const pose=this.hasCharacterLayer||this.software?.layer?characterPose(motion):[0,0,0,0,0];
      const key=[...values,...pose].map(v=>v.toFixed(5)).join('|');
      if(this.lost||!force&&key===this.lastKey)return;this.lastKey=key;if(this.software){this.software.render(values,motion);return;}
      const gl=this.gl;gl.useProgram(this.program);gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.uniform1fv(this.amounts,new Float32Array(values));gl.uniform4fv(this.characterPose,new Float32Array(pose.slice(0,4)));gl.uniform1f(this.bodyY,pose[4]);gl.drawArrays(gl.TRIANGLES,0,6);
    }
  }
  const api={PortraitRenderer,SoftwareRig,controls,characterPose,inverseCharacter,vertex,fragment};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PortraitRendering=api;
})(typeof globalThis!=='undefined'?globalThis:this);
