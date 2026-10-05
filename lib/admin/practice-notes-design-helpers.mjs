/** @fileoverview Pure builders for warm practice-note emails, household dashboard links, and inline-image MIME messages. */
import {randomUUID} from 'node:crypto';
import {normalisePracticeNoteHeadings} from './practice-notes-helpers.mjs';
import {noteMarkupToHtml,stripNoteMarkers,WHOLE_LINE_HEADING} from '../notes-markup.mjs';
import {buildGmailRawMessage} from './practice-notes-email-helpers.mjs';
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const regEscape=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const canonical=new Map([['what we did','What we did'],['progress & challenges','Progress & Challenges'],['practice goals','Practice Goals']]);

function prepare(raw){
  // Stored notes sometimes bold the bracketed heading itself. Unwrap that
  // presentation before applying the shared bracket-to-heading normaliser.
  const unwrapped=raw.replace(/^\s*\*\*(\[[^\]\n]+\])\*\*\s*$/gm,(_,label)=>normalisePracticeNoteHeadings(label)!==label?label:`**${label}**`);
  // Asterisk italics are present in real notes alongside the supported
  // underscore form. Adapt only paired inline markers; never rewrite prose.
  return normalisePracticeNoteHeadings(unwrapped)
    .replace(/(?<!\*)\*(?![\s*])([^*\n]+?)(?<!\s)\*(?!\*)/g,'_$1_');
}

const pStyle='margin:0 0 12px;overflow-wrap:anywhere;word-break:normal;';
const hStyle='margin:22px 0 8px;color:#285448;font-size:20px;line-height:28px;font-weight:bold;';
function renderText(raw,speakers=[],tutorSpeakers=[]){
  const labels=[...new Set(speakers.filter(Boolean))];
  const alternatives=labels.map(regEscape).join('|');
  const prefix=alternatives?new RegExp(`^(${alternatives}):(?:\\s|$)`,'i'):null;
  const lines=[];
  for(let line of raw.split(/\r?\n/)){
    const match=prefix&&stripNoteMarkers(line.trim()).match(prefix);
    if(match){
      // Only explicit, known speaker labels start turns. Keep unattributed
      // paragraphs and all spoken words as written.
      const name=regEscape(match[1]);
      line=line.trim()
        .replace(new RegExp(`^\\*\\*(${name}):\\s+(.+?)\\*\\*`,'i'),'**$1:** **$2**')
        .replace(new RegExp(`^\\*\\*(${name})\\*\\*:`,'i'),'**$1:**')
        .replace(new RegExp(`^(${name}):`,'i'),'**$1:**');
      if(lines.length&&lines.at(-1).trim())lines.push('');
    }
    lines.push(line);
  }
  const html=noteMarkupToHtml(lines.join('\n'),{escape,join:'\n',renderHeading:h=>`<h2 style="${hStyle}">${h}</h2>`});
  const htmlPrefix=alternatives?new RegExp(`^<strong>(${labels.map(s=>regEscape(escape(s))).join('|')}):</strong>`,'i'):null;
  return html
    .replace(/<p>([\s\S]*?)<\/p>/g,(_,body)=>{
      const speaker=htmlPrefix&&body.match(htmlPrefix);
      if(!speaker)return `<p style="${pStyle}">${body}</p>`;
      const tutor=tutorSpeakers.some(n=>escape(n).toLowerCase()===speaker[1].toLowerCase());
      const label=`<strong style="color:${tutor?'#285448':'#8c563f'};">${speaker[1]}:</strong>`;
      return `<p data-dialogue-turn style="margin:0 0 18px;overflow-wrap:anywhere;word-break:normal;">${body.replace(htmlPrefix,label)}</p>`;
    })
    .replace(/<ul>/g,'<ul style="margin:0 0 12px;padding-left:20px;">')
    .replace(/<li>/g,'<li style="margin:0 0 10px;padding-left:2px;overflow-wrap:anywhere;">');
}

function renderNote(raw,{speakers=[],tutorSpeakers=[]}={}){
  const prepared=prepare(raw);
  const blocks=[];
  let label='',buffer=[];
  const flush=()=>{if(label||buffer.join('\n').trim())blocks.push({label,raw:buffer.join('\n').trim()});buffer=[];};
  for(const line of prepared.split(/\r?\n/)){
    const match=line.match(WHOLE_LINE_HEADING);
    const key=match?.[1]?.replace(/:$/,'').trim().toLowerCase();
    if(canonical.has(key)){flush();label=canonical.get(key);}else buffer.push(line);
  }
  flush();
  const html=blocks.map(block=>{
    if(block.label&&!block.raw)return '';
    const body=renderText(block.raw,speakers,tutorSpeakers);
    if(block.label==='Practice Goals'&&block.raw){
      return `<table role="presentation" data-practice-panel width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:22px 0 0;background-color:#edf2e9;border:1px solid #dbe4d7;border-radius:8px;"><tr><td style="padding:18px;font-size:16px;line-height:26px;color:#293a35;"><h2 style="margin:0 0 12px;color:#285448;font-size:20px;line-height:28px;font-weight:bold;">Practice Goals</h2>${body}</td></tr></table>`;
    }
    // Render only populated sections; no placeholder advice is added.
    return (block.label?`<h2 style="${hStyle}">${escape(block.label)}</h2>`:'')+body;
  }).join('\n');
  return {html,prepared,plain:stripNoteMarkers(prepared),hasGoals:blocks.some(b=>b.label==='Practice Goals'&&b.raw),sections:blocks.filter(b=>b.label).map(b=>b.label)};
}

function dateLabel(value){const date=new Date(value);return Number.isNaN(date.getTime())?'Past lesson':new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'}).format(date);}

function renderStyledHtml(sample,showProtection){
  const tutorSpeakers=[sample.tutor,...sample.tutor.split(/\s+/).filter(n=>n.length>2)].filter(Boolean);
  const rendered=renderNote(sample.raw,{tutorSpeakers,speakers:[...tutorSpeakers,...sample.learners,...sample.learners.flatMap(n=>n.split(/\s+/).filter(part=>part.length>2))]});
  const learnerLabel=sample.studentName;
  const footerLinks=sample.dashboardLinks.map(({studentName,url})=>`<a href="${escape(url)}" style="display:inline-block;margin:0 16px 4px 0;color:#285448;font-size:14px;line-height:22px;text-decoration:underline;">Open ${escape(studentName)}’s dashboard →</a>`).join('');
  const footerCopy=sample.learners.length>1?'Notes and songs are always on each student’s dashboard.':`Notes and songs are always on ${escape(learnerLabel)}’s dashboard.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${escape(sample.label)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f2ed;color:#293a35;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f4f2ed;"><tr><td align="center" style="padding:24px 16px 32px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
<tr><td bgcolor="#fdfcf9" style="background-color:#fdfcf9;border:1px solid #e3e5dd;border-radius:12px;overflow:hidden;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr><td style="padding:22px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr><td valign="top" style="padding:10px 12px 0 0;"><p style="margin:0;color:#285448;font-size:18px;line-height:24px;font-weight:bold;letter-spacing:-0.3px;">First Chord<span style="color:#b56549;">.</span></p><table role="presentation" width="48" cellpadding="0" cellspacing="0" border="0" style="width:48px;margin-top:16px;"><tr><td width="24" height="3" style="width:24px;height:3px;background-color:#285448;font-size:0;line-height:0;">&nbsp;</td><td width="14" height="3" style="width:14px;height:3px;background-color:#b56549;font-size:0;line-height:0;">&nbsp;</td><td width="10" height="3" style="width:10px;height:3px;background-color:#c3a36d;font-size:0;line-height:0;">&nbsp;</td></tr></table></td><td width="72" align="right" valign="top" style="width:72px;"><img src="cid:firstchord-music-map@firstchord.co.uk" width="72" height="72" alt="" style="display:block;width:72px;height:72px;border:0;"></td></tr></table>
<h1 style="margin:12px 0 8px;color:#25483f;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:38px;font-weight:normal;letter-spacing:-0.6px;overflow-wrap:anywhere;">${escape(learnerLabel)}’s lesson notes</h1><p style="margin:0;color:#647169;font-size:13px;line-height:20px;overflow-wrap:anywhere;">${escape(dateLabel(sample.date))} · ${escape(sample.tutor)}</p></td></tr>
<tr><td data-note-body style="padding:14px 28px 20px;font-size:16px;line-height:26px;"><p style="margin:0 0 16px;">${escape(sample.intro)}</p>${rendered.html}</td></tr>
${sample.dashboardLinks.length?`<tr><td style="padding:0 28px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #e3e5dd;"><tr><td style="padding-top:22px;font-size:14px;line-height:22px;"><p style="margin:0 0 10px;color:#59665f;">${footerCopy}</p><p style="margin:0;">${footerLinks}</p>${showProtection?'<p data-protection-reminder style="margin:6px 0 0;color:#59665f;font-size:13px;line-height:20px;">If asked for a notes code, you’ll find it in your First Chord WhatsApp group description.</p>':''}</td></tr></table></td></tr>`:''}
</table></td></tr></table>
<!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}


export const PRACTICE_NOTE_INTROS = Object.freeze([
  'Practice notes! At this time? I’m afraid so:',
  'Here at First Chord, we flash-freeze our practice notes at peak freshness to lock in nutrition. 🔐',
  'Your practice notes are below. But before we get into that, it would be remiss of us not to say that your practice notes are below.',
]);

export function buildStyledPracticeNoteContent({
  studentName='', studentNames=[], tutorName='', noteText='', lessonDate='',
  dashboardUrl='', dashboardLinks=[], protectionEnabled=false, intro=PRACTICE_NOTE_INTROS[0],
}={}){
  const links=(dashboardLinks.length?dashboardLinks:dashboardUrl?[{studentName,url:dashboardUrl}]:[]).map(link=>{
    const url=new URL(link.url);
    const allowedHost=['firstchord.co.uk','first-chord-dashbord-production.up.railway.app'].includes(url.hostname);
    if(url.protocol!=='https:'||!allowedHost||url.username||url.password||url.port||!/^\/[a-z0-9_-]+$/.test(url.pathname)||['admin','api','dashboard','student'].includes(url.pathname.slice(1))||url.search||url.hash)throw new Error('Invalid practice-note dashboard URL.');
    return {studentName:link.studentName,url:url.href};
  });
  const sample={raw:noteText,studentName,learners:studentNames.length?studentNames:[studentName],dashboardLinks:links,tutor:tutorName,date:lessonDate,label:`${studentName}’s lesson notes`,intro};
  const html=renderStyledHtml(sample,protectionEnabled);
  const plain=[`${studentName}’s lesson notes`,`${dateLabel(lessonDate)} · ${tutorName}`,intro,stripNoteMarkers(prepare(noteText)),...links.map(link=>`Notes and songs for ${link.studentName}: ${link.url}`),links.length&&protectionEnabled?'If asked for a notes code, you’ll find it in your First Chord WhatsApp group description.':''].filter(Boolean).join('\n\n');
  return {html,plain};
}

export function buildGmailRawMessageWithIllustration(options={},illustration){
  if(!Buffer.isBuffer(illustration)||!illustration.length)throw new Error('Practice-note illustration is missing.');
  const oldMessage=Buffer.from(buildGmailRawMessage(options),'base64url').toString('utf8');
  const divider=oldMessage.indexOf('\r\n\r\n');
  const oldHeaders=oldMessage.slice(0,divider).split('\r\n');
  const oldBody=oldMessage.slice(divider+4);
  const alternative=oldHeaders.find(h=>h.startsWith('Content-Type:'));
  const id=randomUUID();const related=`firstchord_related_${id}`;
  const headers=oldHeaders.filter(h=>!h.startsWith('Content-Type:'));
  headers.push(`Date: ${new Date().toUTCString()}`,`Message-ID: <${id}@firstchord.co.uk>`,`Content-Type: multipart/related; boundary="${related}"; type="multipart/alternative"`);
  const encoded=illustration.toString('base64').match(/.{1,76}/g).join('\r\n');
  const message=[...headers,'',`--${related}`,alternative,'',oldBody,`--${related}`,'Content-Type: image/png; name="firstchord-music-map.png"','Content-Transfer-Encoding: base64','Content-ID: <firstchord-music-map@firstchord.co.uk>','Content-Disposition: inline; filename="firstchord-music-map.png"','',encoded,`--${related}--`,''].join('\r\n');
  return Buffer.from(message,'utf8').toString('base64url');
}
