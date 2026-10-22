// Only the current, already-authorized board is indexed. No discovery requests,
// title rewrites, generated content or automatic creation of missing notes.
const fields = ['body','userText','annotation'];
const names = {body:'正文',userText:'自己的说明',annotation:'备注'};
const el=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;};
export function installReferences(parser) {
  parser.inline.ruler.before('link','creative_reference',(state,silent)=>{
    // Let Markdown's link-label probe account for its own nested brackets.
    // Inside an external link, a wiki-looking label remains ordinary text.
    if(silent || state.linkLevel || state.src.slice(state.pos,state.pos+2)!=='[[')return false;
    const offset=state.src.slice(state.pos+2,Math.min(state.posMax,state.pos+602)).indexOf(']]');
    if(offset<0)return false;
    const end=state.pos+2+offset,raw=state.src.slice(state.pos+2,end);
    if(!raw || raw.includes('\n'))return false;
    if(!silent){const token=state.push('creative_reference','',0);token.content=raw;token.meta={start:state.pos};}
    state.pos=end+2;return true;
  });
  parser.renderer.rules.creative_reference=(tokens,i,options,env)=>{
    const [target,...alias]=tokens[i].content.split('|'),label=alias.join('|')||target;
    const result=env?.references?.resolve(target),escape=parser.utils.escapeHtml;
    if(result && ['resolved','ambiguous'].includes(result.status))return `<button type="button" class="wiki-reference" data-reference="${escape(target)}" aria-label="${escape('查看关联原文：'+label)}">${escape(label)}</button>`;
    const caption=result?.status==='external'?'这条引用指向其他白板，当前尚未接入':'当前白板没有可确认的引用目标';
    return `<span class="wiki-reference unavailable" title="${caption}">${escape(label)}</span>`;
  };
}
export class ReferenceIndex {
  constructor(key,parser){this.key=key;this.parser=parser;this.cache=new WeakMap();this.nodes=[];this.ids=new Map();this.titles=new Map();this.rows=new Map();}
  update(board){
    this.nodes=(board?.nodes||[]).filter(n=>n.type!=='frame');this.ids=new Map();this.titles=new Map();this.rows=new Map();
    for(const node of this.nodes){
      this.ids.set(node.id,node);
      if(node.title){const matches=this.titles.get(node.title)||[];matches.push(node);this.titles.set(node.title,matches);}
      const signature=JSON.stringify([node.textFormat,...fields.map(key=>node[key])]);let cached=this.cache.get(node);
      if(!cached||cached.signature!==signature){
        const refs=[],groups=new Map();
        if(node.textFormat==='markdown')for(const field of fields){
          const raw=typeof node[field]==='string'?node[field]:'';
          for(const block of this.parser.parse(raw,{}))for(const token of block.children||[]){
            if(token.type!=='creative_reference')continue;
            const [target,...alias]=token.content.split('|');
            // A literal authored excerpt, never a generated description.
            const key=JSON.stringify([target,field]),existing=groups.get(key);
            if(existing)existing.count++;else {
              const paragraph=block.content||raw,start=Math.max(0,(token.meta?.start||0)-60),end=Math.min(paragraph.length,start+180);
              const excerpt=(start?'…':'')+paragraph.slice(start,end)+(end<paragraph.length?'…':'');
              const ref={target,label:alias.join('|')||target,field,excerpt,count:1};groups.set(key,ref);refs.push(ref);
            }
          }
        }
        cached={signature,refs};this.cache.set(node,cached);
      }
      this.rows.set(node.id,cached.refs);
    }
  }
  resolve(target){
    const explicit=/^@([a-zA-Z0-9_-]+)\/([^\]|]+)$/.exec(target);
    if(explicit){if(explicit[1]!==this.key)return {status:'external',candidates:[]};const node=this.ids.get(explicit[2]);return {status:node?'resolved':'missing',node,candidates:node?[node]:[]};}
    const matches=new Map();const id=this.ids.get(target);if(id)matches.set(id.id,id);
    for(const node of this.titles.get(target)||[])matches.set(node.id,node);
    const candidates=[...matches.values()];return {status:candidates.length===1?'resolved':candidates.length?'ambiguous':'missing',node:candidates.length===1?candidates[0]:undefined,candidates};
  }
  outgoing(node){
    const rows=new Map();for(const ref of this.rows.get(node.id)||[]){const result=this.resolve(ref.target),key=result.node?'node:'+result.node.id:'target:'+ref.target,old=rows.get(key);if(old)old.count+=ref.count;else rows.set(key,{...ref,...result});}return [...rows.values()];
  }
  incoming(node){
    const result=[];
    for(const source of this.nodes){
      const matches=(this.rows.get(source.id)||[]).filter(ref=>this.resolve(ref.target).node?.id===node.id);
      if(matches.length)result.push({node:source,...matches[0],count:matches.reduce((sum,ref)=>sum+ref.count,0)});
    }
    return result;
  }
  link(node,label){
    if(!/^[a-zA-Z0-9_-]+$/.test(this.key)||!node||!node.id||/[\]|\r\n]/.test(node.id))throw Error('这块内容的编号暂时不能插入引用；原文没有改动。');
    const raw='@'+this.key+'/'+node.id+'|'+label;
    if(!label||/[\r\n]/.test(label)||label.includes(']]')||raw.length>598)throw Error('所选文字太长、包含换行或 ]]，请缩短选择后再插入；原文没有改动。');
    return '[['+raw+']]';
  }
}
export class NoteReferences {
  constructor(index,{navigate,insert,canBrowse,canEdit,activeNode}){
    this.index=index;Object.assign(this,{navigate,insert,canBrowse,canEdit,activeNode});
    this.limits={out:8,in:8};this.signature='';this.selected=null;this.bookmark=null;this.picker=null;this.dialog=document.getElementById('referenceDialog');
    this.$=id=>document.getElementById(id);
    this.lastField='noteBody';
    for(const id of ['noteBody','noteUserText','noteAnnotation'])this.$(id).addEventListener('focus',()=>{this.lastField=id;});
    this.$('insertReference').onpointerdown=event=>event.preventDefault();
    this.$('insertReference').onclick=()=>this.choose();
    this.$('closeReferences').onclick=()=>this.dialog.close();
    this.dialog.addEventListener('close',()=>{if(this.dialog.open)return;const place=this.bookmark;this.picker=null;this.bookmark=null;this.$('referenceChoices').replaceChildren();this.$('referenceSearch').value='';if(place&&this.activeNode()?.id===place.node&&this.$(place.field).value===place.raw){const field=this.$(place.field);field.focus({preventScroll:true});field.setSelectionRange(place.start,place.end);field.scrollTop=place.scroll;}});
    this.$('referenceSearch').oninput=()=>{if(this.picker){this.picker.limit=20;this.drawChoices();}};
  }
  sync(){
    const node=this.activeNode();const browse=this.canBrowse();
    this.$('insertReference').disabled=!this.canEdit();
    if(!browse){
      if(this.dialog.open)this.dialog.close();this.$('referenceOutgoing').replaceChildren();this.$('referenceIncoming').replaceChildren();
      for(const id of ['referenceOutgoing','referenceIncoming','referenceOutgoingTitle','referenceIncomingTitle'])this.$(id).hidden=true;
      this.$('referenceSummary').textContent='关联原文 · 访问已暂停';this.$('referenceMessage').textContent='引用跳转已暂停；这页原文仍可导出。';this.signature='';return;
    }
    if(!node)return;
    if(this.dialog.open&&this.picker?.insert&&!this.canEdit()){this.dialog.close();this.$('referenceMessage').textContent='现在只有阅读权限，未插入引用；所选原文仍然保留。';}
    const changed=this.selected!==node.id;
    if(changed){this.selected=node.id;this.lastField='noteBody';this.limits={out:8,in:8};this.signature='';this.$('referenceMessage').textContent='';}
    const out=this.index.outgoing(node),incoming=this.index.incoming(node);
    const signature=JSON.stringify([node.id,out.map(r=>[r.target,r.status,r.count,r.node?.id,r.node?.title,(r.node?.body||r.node?.userText||r.node?.annotation||'').slice(0,180),r.candidates.map(n=>n.id)]),incoming.map(r=>[r.node.id,r.node.title,r.field,r.excerpt,r.count]),this.limits]);
    if(signature===this.signature)return;this.signature=signature;
    this.$('referenceSummary').textContent=`关联原文 · 引用 ${out.length} · 被引用 ${incoming.length}`;
    // Give the useful direction the space; the summary retains both counts.
    this.$('referenceOutgoingTitle').hidden=this.$('referenceOutgoing').hidden=Boolean(incoming.length&&!out.length);
    this.$('referenceIncomingTitle').hidden=this.$('referenceIncoming').hidden=!incoming.length;
    if(changed)this.$('noteReferences').open=Boolean(out.length||incoming.length);
    const focus=document.activeElement,restore=focus?.dataset.referenceKey,hadFocus=Boolean(focus?.closest('#noteReferences'));
    this.drawRows('referenceOutgoing',out,'out');this.drawRows('referenceIncoming',incoming,'in');
    if(hadFocus){const replacement=[...this.$('noteReferences').querySelectorAll('[data-reference-key]')].find(x=>x.dataset.referenceKey===restore);(replacement||this.$('referenceSummary')).focus({preventScroll:true});}
  }
  drawRows(id,rows,kind){
    const host=this.$(id);host.replaceChildren();
    if(!rows.length){host.append(el('p',kind==='out'?'还没有引用；可选中文字后插入。':'当前白板没有其他内容明确引用这一张。','reference-empty'));return;}
    for(const row of rows.slice(0,this.limits[kind])){
      const active=kind==='in'||['resolved','ambiguous'].includes(row.status);
      const item=el(active?'button':'div',undefined,'reference-row');if(active){item.type='button';item.dataset.referenceRead='';}
      item.dataset.referenceKey=kind+':'+(kind==='in'?row.node.id:row.target);
      item.append(el('strong',kind==='in'?(row.node.title||'未命名内容'):(row.node?.title||row.label)));
      const description=kind==='in'?names[row.field]+` · ${row.count}处引用`:row.status==='resolved'?`原文 · ${row.count}处引用`:row.status==='ambiguous'?`有${row.candidates.length}块同名内容，请选择`:row.status==='external'?'指向其他白板 · 尚未接入':'目标不存在或已改名 · 原文保留';
      item.append(el('small',description));
      if(kind==='in'||row.node){const excerpt=kind==='in'?row.excerpt:(row.node.body||row.node.userText||row.node.annotation||'').slice(0,180);if(excerpt)item.append(el('span',excerpt,'reference-excerpt'));}
      if(active)item.onclick=()=>{if(!this.canBrowse())return;if(kind==='in')this.navigate(row.node,{field:row.field});else this.follow(row.target);};host.append(item);
    }
    if(rows.length>this.limits[kind]){const more=el('button',`再显示 ${Math.min(8,rows.length-this.limits[kind])} 项`,'reference-more');more.type='button';more.dataset.referenceRead='';more.dataset.referenceKey=kind+':more';more.onclick=()=>{this.limits[kind]+=8;this.sync();};host.append(more);}
  }
  follow(target){
    if(!this.canBrowse())return;const result=this.index.resolve(target);
    if(result.status==='resolved')this.navigate(result.node,{});
    else if(result.status==='ambiguous')this.choose(result.candidates);
    else this.$('referenceMessage').textContent=result.status==='external'?'这条引用指向其他白板，当前尚未接入。':'引用目标不存在或已改名；引用原文仍然保留。';
  }
  choose(candidates){
    if(!this.canBrowse()||(!candidates&&!this.canEdit()))return;
    const node=this.activeNode();if(!candidates&&!node)return;
    const field=this.$(this.lastField);
    this.bookmark={node:node?.id,field:field.id,start:field.selectionStart,end:field.selectionEnd,scroll:field.scrollTop,raw:field.value};
    this.picker={candidates:candidates||this.index.nodes.filter(n=>n.id!==node.id),insert:!candidates,limit:20};
    this.$('referenceTitle').textContent=candidates?'选择要查看的原文':'链接到白板里的内容';
    this.$('referenceHint').textContent=candidates?'存在同名内容。看清原文再选择；引用文字不会被改写。':'只从当前白板选择。插入后按 Markdown 显示，使用固定编号；目标改名后仍能找到。';
    this.$('referenceSearch').value='';this.$('referenceChoiceState').textContent='';this.drawChoices();this.dialog.showModal();this.$('referenceSearch').focus();
  }
  drawChoices(){
    const host=this.$('referenceChoices');host.replaceChildren();if(!this.picker)return;
    const query=this.$('referenceSearch').value.toLocaleLowerCase();const candidates=this.picker.candidates.filter(n=>this.index.ids.get(n.id)===n&&(n.title||'').toLocaleLowerCase().includes(query));
    for(const node of candidates.slice(0,this.picker.limit)){
      const button=el('button',undefined,'reference-row');button.type='button';button.dataset.referenceChoice=node.id;
      button.append(el('strong',node.title||'未命名内容'),el('small',(node.type==='note'?'便签':node.type==='table'?'表格':'素材')+' · '+node.id.slice(0,12)));
      const excerpt=(node.body||node.userText||node.annotation||'').slice(0,180);if(excerpt)button.append(el('span',excerpt,'reference-excerpt'));
      button.onclick=()=>{
        if(!this.canBrowse()||!this.index.ids.has(node.id))return;
        if(this.picker.insert){
          if(!this.canEdit()||this.activeNode()?.id!==this.bookmark.node)return;
          const field=this.$(this.bookmark.field);if(field.value!==this.bookmark.raw){this.$('referenceChoiceState').textContent='编辑原文已经变化，请关闭后重新选择文字。';return;}
          const selected=field.value.slice(this.bookmark.start,this.bookmark.end),label=selected||node.title||'未命名内容';
          let link;try{link=this.index.link(node,label);}catch(error){this.$('referenceChoiceState').textContent=error.message;return;}
          const place=this.bookmark;this.dialog.close();this.insert(place,link);
        }else {this.dialog.close();this.navigate(node,{});}
      };host.append(button);
    }
    if(!candidates.length)host.append(el('p','当前白板没有匹配的内容。','reference-empty'));
    if(candidates.length>this.picker.limit){const more=el('button',`再显示 ${Math.min(20,candidates.length-this.picker.limit)} 项`,'reference-more');more.type='button';more.onclick=()=>{this.picker.limit+=20;this.drawChoices();};host.append(more);}
  }
}
