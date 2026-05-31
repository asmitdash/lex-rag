import { writeFileSync } from 'node:fs'
import zlib from 'node:zlib'

function makePdf(text, filename) {
  const lines = text.split('\n')
  let stream = 'BT /F1 11 Tf 50 750 Td 14 TL '
  for (const line of lines) {
    const safe = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    stream += `(${safe}) Tj T* `
  }
  stream += 'ET'
  const compressed = zlib.deflateSync(Buffer.from(stream, 'latin1'))
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream'),
    ]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]
  let out = Buffer.from('%PDF-1.4\n')
  const offsets = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length)
    out = Buffer.concat([
      out,
      Buffer.from(`${i + 1} 0 obj\n`),
      objects[i],
      Buffer.from('\nendobj\n'),
    ])
  }
  const xrefPos = out.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`
  out = Buffer.concat([
    out,
    Buffer.from(xref),
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`,
    ),
  ])
  writeFileSync(filename, out)
  console.log(`wrote ${filename} (${out.length} bytes)`)
}

const bns = `Bharatiya Nyaya Sanhita 2023 - Sample Excerpt

Section 101. Culpable homicide.
A person commits culpable homicide if he causes death by doing an act with the intention of causing death, or with the intention of causing such bodily injury as is likely to cause death.

Section 103. Punishment for murder.
Whoever commits murder shall be punished with death or imprisonment for life, and shall also be liable to fine. This section corresponds to the erstwhile Section 302 of the Indian Penal Code.

Section 117. Voluntarily causing grievous hurt.
Whoever voluntarily causes grievous hurt shall be punished with imprisonment of either description for a term which may extend to seven years.

Mapping notes:
- IPC 302 maps to BNS 103.
- IPC 299 maps to BNS 100.
- IPC 304 maps to BNS 105.

Teaching excerpt for LexRAG alpha test.`

const itAct = `Income Tax Act 1961 - Sample Excerpt

Section 143(2). Notice for scrutiny assessment.
Where a return has been furnished, the Assessing Officer may, if he considers it necessary or expedient, serve on the assessee a notice requiring him to attend the office or to produce evidence on which the assessee may rely in support of the return.

Section 148. Issue of notice where income has escaped assessment.
Before making the assessment, reassessment or recomputation under section 147, the Assessing Officer shall issue a notice to the assessee requiring him to furnish a return of his income.

Section 80C. Deductions in respect of life insurance premia and provident fund contributions.
In computing the total income of an individual or HUF, the whole of the amount paid or deposited in the previous year shall be deducted, subject to limits prescribed.

Teaching excerpt for LexRAG alpha test.`

makePdf(bns, 'C:/tmp/test_bns.pdf')
makePdf(itAct, 'C:/tmp/test_it_act.pdf')
