import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStyledPracticeNoteContent,buildGmailRawMessageWithIllustration} from '../../lib/admin/practice-notes-design-helpers.mjs';
import {preparePracticeNoteEmail} from '../../lib/admin/practice-notes-email.js';
import {buildPracticeNoteEmailContent} from '../../lib/admin/practice-notes-email-helpers.mjs';
import {STUDENTS_REGISTRY} from '../../lib/config/students-registry.js';
import {isTestStudentRecord} from '../../lib/admin/test-student-helpers.mjs';
const base={studentName:'Test Studenty',tutorName:'Finn Le Marinel',noteText:'[What we did]\nFinn: First turn.\n**Test Studenty:** Second turn.\n**Finn: A & B**.\nTempo: 100\n\n[Practice Goals]\n- Try <script>alert(1)</script> as literal text.',lessonDate:'2026-10-04T13:30:00',dashboardUrl:'https://firstchord.co.uk/test'};
const image=Buffer.from('test-image');
test('explicit dialogue turns are separated while notation and literal HTML stay intact',()=>{
 const c=buildStyledPracticeNoteContent(base);
 assert.equal((c.html.match(/data-dialogue-turn/g)||[]).length,3);
 assert.match(c.html,/Finn:<\/strong> First turn/);
 assert.match(c.html,/Test Studenty:<\/strong> Second turn/);
 assert.match(c.html,/A &amp; B/);
 assert.match(c.html,/Tempo: 100/);
 assert.match(c.html,/&lt;script&gt;/);assert.doesNotMatch(c.html,/<script>/);
 assert.match(c.html,/font-size:20px/);assert.match(c.plain,/First turn/);assert.match(c.plain,/At this time/);
});
test('dashboard link and conditional reminder are usable without exposing a code',()=>{
 const c=buildStyledPracticeNoteContent({...base,protectionEnabled:true});
 assert.match(c.html,/href="https:\/\/firstchord.co.uk\/test"/);
 assert.match(c.plain,/WhatsApp group description/);
 assert.doesNotMatch(buildStyledPracticeNoteContent(base).html,/data-protection-reminder/);
 assert.throws(()=>buildStyledPracticeNoteContent({...base,dashboardUrl:'javascript:alert(1)'}));
 const noLink=buildStyledPracticeNoteContent({...base,dashboardUrl:''});assert.doesNotMatch(noLink.html,/Open Test Studenty/);
});
test('inline image MIME retains both alternatives and recipient privacy',()=>{
 const c=buildStyledPracticeNoteContent(base);
 const message=Buffer.from(buildGmailRawMessageWithIllustration({fromEmail:'school@example.com',fromName:'School',toEmail:'one@example.com',bccEmails:['two@example.com','one@example.com'],subject:'Test',plainText:c.plain,html:c.html},image),'base64url').toString();
 assert.match(message,/To: one@example.com\r\nBcc: two@example.com/);
 assert.match(message,/multipart\/related/);assert.match(message,/multipart\/alternative/);
 assert.match(message,/text\/plain/);assert.match(message,/text\/html/);
 assert.match(message,/Content-ID: <firstchord-music-map@firstchord.co.uk>/);assert.match(message,/Message-ID: </);
});
test('rollback flag avoids all design reads and preserves the established email',async()=>{
 const forbid=()=>{throw new Error('Unexpected provider read');};
 for(const options of [{studentMmsId:'sdt_fBg9JN',designEnabled:false},{studentMmsId:'unknown-real-student',designEnabled:false}]){
  const p=await preparePracticeNoteEmail({...base,...options,readProtection:forbid,readIllustration:forbid});
  assert.deepEqual(p.content,buildPracticeNoteEmailContent({...base,studentName:'Test'}));assert.equal(p.illustration,null);
 }
});
test('missing optional protection state still produces a styled note',async()=>{
 const p=await preparePracticeNoteEmail({...base,studentMmsId:'sdt_fBg9JN',readProtection:async()=>{throw new Error('Unavailable');},readIllustration:async()=>image,warn:()=>{}});
 assert.match(p.content.html,/At this time/);assert.doesNotMatch(p.content.html,/WhatsApp group description/);assert.equal(p.illustration,image);
});
test('missing illustration falls back to the established email instead of blocking delivery',async()=>{
 const p=await preparePracticeNoteEmail({...base,studentMmsId:'sdt_fBg9JN',readProtection:async()=>null,readIllustration:async()=>{throw new Error('Missing');},warn:()=>{}});
 assert.deepEqual(p.content,buildPracticeNoteEmailContent({...base,studentName:'Test'}));assert.equal(p.illustration,null);
});

test('subtle ivory card declares light-only rendering for supporting mail clients',()=>{
 const c=buildStyledPracticeNoteContent(base);
 assert.match(c.html,/<meta name="color-scheme" content="light only">/);
 assert.match(c.html,/bgcolor="#fdfcf9" style="background-color:#fdfcf9/);
});

test('household email links only explicitly covered students, not everyone on the lesson',async()=>{
 const entries=[['sdt_fBg9JN','Test Studenty'],['sdt_test_sibling','Sibling']];
 // An unknown mapping cannot accidentally reuse the first student's URL.
 const p=await preparePracticeNoteEmail({...base,studentMmsId:'sdt_fBg9JN',studentName:'Test Studenty and Sibling',emailStudents:entries.map(([studentMmsId,studentName])=>({studentMmsId,studentName})),readProtection:async()=>({protectionEnabled:true,activeCodeCiphertext:'SECRET-CODE-MATERIAL'}),readIllustration:async()=>image});
 assert.match(p.content.html,/Test and Sibling’s lesson notes/);
 assert.equal((p.content.html.match(/href="https:\/\/first-chord-dashbord-production.up.railway.app\/test"/g)||[]).length,1);
 assert.doesNotMatch(p.content.html,/Open Sibling’s dashboard/);
 assert.match(p.content.html,/each student’s dashboard/);
 assert.doesNotMatch(p.content.html,/SECRET-CODE-MATERIAL/);
});

test('multiple known household links and names remain separate and escaped',()=>{
 const c=buildStyledPracticeNoteContent({...base,studentName:'Ada & Ben',studentNames:['Ada','Ben'],dashboardLinks:[{studentName:'Ada',url:'https://firstchord.co.uk/ada'},{studentName:'Ben',url:'https://firstchord.co.uk/ben'}],protectionEnabled:true,noteText:'[What we did]\nAda: Hello.\nBen: Goodbye.'});
 assert.match(c.html,/Ada &amp; Ben’s lesson notes/);
 assert.match(c.html,/href="https:\/\/firstchord.co.uk\/ada"/);
 assert.match(c.html,/href="https:\/\/firstchord.co.uk\/ben"/);
 assert.equal((c.html.match(/data-dialogue-turn/g)||[]).length,2);
 assert.equal((c.html.match(/data-protection-reminder/g)||[]).length,1);
 assert.match(c.plain,/Notes and songs for Ben: https:\/\/firstchord.co.uk\/ben/);
});

test('unknown registry student keeps the design but has no invented dashboard link or protection read',async()=>{
 const p=await preparePracticeNoteEmail({...base,studentMmsId:'unknown',readProtection:()=>{throw new Error('Unexpected read');},readIllustration:async()=>image});
 assert.match(p.content.html,/At this time/);
 assert.doesNotMatch(p.content.html,/href=|data-protection-reminder/);
});

test('invalid or empty image gracefully falls back before the Gmail call',async()=>{
 for(const badImage of [null,Buffer.alloc(0),'not-a-buffer']){
  const p=await preparePracticeNoteEmail({...base,studentMmsId:'sdt_fBg9JN',readProtection:async()=>null,readIllustration:async()=>badImage,warn:()=>{}});
  assert.deepEqual(p.content,buildPracticeNoteEmailContent({...base,studentName:'Test'}));
  assert.equal(p.illustration,null);
 }
});

test('first-name headings omit surnames and instrument suffixes without rewriting dialogue',async()=>{
 const noteText='[What we did]\nTabitha Example (voice): I enjoyed the chorus.\nFinn: Keep working on the bridge.';
 const p=await preparePracticeNoteEmail({...base,studentMmsId:'unknown',studentName:'Tabitha Example (voice)',noteText,readIllustration:async()=>image});
 assert.equal(p.studentLabel,'Tabitha');
 assert.match(p.content.html,/<h1[^>]*>Tabitha’s lesson notes<\/h1>/);
 assert.ok(p.content.plain.startsWith('Tabitha’s lesson notes\n'));
 assert.match(p.content.html,/Tabitha Example \(voice\):<\/strong> I enjoyed the chorus/);
 assert.match(p.content.plain,/Tabitha Example \(voice\): I enjoyed the chorus/);
});

test('covered household first names remain separate, including compound names and duplicate first names',async()=>{
 const emailStudents=[{studentMmsId:'unknown-one',studentName:'Mary Jane Example',firstName:'Mary Jane (piano)'},{studentMmsId:'unknown-two',studentName:'Simon Sample',firstName:'Simon'},{studentMmsId:'unknown-three',studentName:'Simon Other',firstName:'Simon'}];
 for(const designEnabled of [true,false]){
  const p=await preparePracticeNoteEmail({...base,studentName:'Mary Jane Example, Simon Sample and Simon Other',emailStudents,designEnabled,readIllustration:async()=>image});
  assert.equal(p.studentLabel,'Mary Jane, Simon and Simon');
  assert.match(p.content.plain,/Mary Jane, Simon and Simon/);
  assert.doesNotMatch(p.content.html,/Example|Sample|Other|piano/);
  assert.doesNotMatch(p.content.html,/href=/);
 }
});

test('registry first names label the heading and dashboard link without changing the URL',async()=>{
 const [studentMmsId,entry]=Object.entries(STUDENTS_REGISTRY).find(([,record])=>record.firstName&&record.friendlyUrl&&!isTestStudentRecord(record));
 const p=await preparePracticeNoteEmail({...base,studentMmsId,studentName:`${entry.firstName} ${entry.lastName}`,noteText:'[What we did]\nPlayed a scale.',readProtection:async()=>null,readIllustration:async()=>image});
 assert.equal(p.studentLabel,entry.firstName);
 assert.ok(p.content.plain.startsWith(`${entry.firstName}’s lesson notes`));
 assert.ok(p.content.plain.includes(`Notes and songs for ${entry.firstName}: https://firstchord.co.uk/${entry.friendlyUrl}`));
 assert.ok(!p.content.plain.includes(entry.lastName));
});

test('dashboard URLs reject credentials, foreign paths and code-bearing queries',()=>{
 for(const dashboardUrl of ['https://firstchord.co.uk/admin','https://firstchord.co.uk/test?code=secret','https://user:pass@firstchord.co.uk/test','https://evil.example/student/test']){
  assert.throws(()=>buildStyledPracticeNoteContent({...base,dashboardUrl}));
 }
});

test('a stalled optional protection lookup cannot stall the practice email',async()=>{
 const p=await preparePracticeNoteEmail({...base,studentMmsId:'sdt_fBg9JN',protectionTimeoutMs:10,readProtection:()=>new Promise(()=>{}),readIllustration:async()=>image});
 assert.match(p.content.html,/At this time/);
 assert.doesNotMatch(p.content.html,/data-protection-reminder/);
 assert.equal(p.illustration,image);
});

test('ordinary students use the established school profile URL, while explicit test profiles use the app',async()=>{
 const [studentMmsId,entry]=Object.entries(STUDENTS_REGISTRY).find(([,record])=>record.friendlyUrl&&!isTestStudentRecord(record));
 const p=await preparePracticeNoteEmail({...base,studentMmsId,studentName:'Example learner',readProtection:async()=>null,readIllustration:async()=>image});
 assert.ok(p.content.html.includes(`href="https://firstchord.co.uk/${entry.friendlyUrl}"`));
 assert.doesNotMatch(p.content.html,/href="https:\/\/first-chord-dashbord-production/);
 assert.doesNotMatch(p.content.html,/href="https:\/\/firstchord.co.uk\/student\//);
});
