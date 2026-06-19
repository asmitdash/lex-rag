import Link from 'next/link'

export const dynamic = 'force-static'

export default function UseCasesPage() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white">
        <Link href="/" className="font-semibold text-lg tracking-tight">Lex-Rag</Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm px-3 py-1.5 rounded-md hover:bg-zinc-100"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="text-sm px-3 py-1.5 rounded-md bg-zinc-900 text-white hover:bg-zinc-700"
          >
            Sign up
          </Link>
        </nav>
      </header>

      <section className="flex-1 px-6 py-16">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Use cases
          </h1>
          <p className="mt-3 text-zinc-600 max-w-2xl">
            Lex-Rag is a domain-neutral advanced RAG platform. Below are concrete products
            built on top of it — and a self-serve demo for any corpus.
          </p>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
            <UseCaseCard
              title="Jolly"
              tagline="AI assistant for Indian Chartered Accountants and Lawyers."
              body={
                <>
                  RAG over BNS / BNSS / BSA + IT &amp; GST Acts plus your firm's PDFs.
                  Adds OCR (Tesseract + OpenCV with Bedrock Claude Opus 4.7 vision fallback) for
                  scanned commentaries and image-based statute books. Role-based visibility
                  for CAs vs Lawyers.
                </>
              }
              cta="Open Jolly →"
              href={process.env.NEXT_PUBLIC_JOLLY_URL ?? 'https://jolly.example'}
              external
              tagText="Live · separate product"
            />

            <UseCaseCard
              title="Bring your own corpus"
              tagline="Upload, ask, get cited answers. No domain assumptions."
              body={
                <>
                  Drag in a few PDFs and try Lex-Rag's full advanced stack — contextual
                  embeddings, hybrid BM25 + vector + RRF, BGE cross-encoder rerank, agentic
                  multi-hop, GraphRAG, and Self-RAG critique — on your own documents.
                  Anonymous, rate-limited, no signup.
                </>
              }
              cta="Try the demo →"
              href="/try-it"
              tagText="Self-serve · 10 queries / day"
            />
          </div>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
            <Pillar
              title="Pluggable retrieval"
              body="Single orchestrator, three modes: your private corpus, the live web, or both fused via reciprocal rank fusion."
            />
            <Pillar
              title="Top-of-class accuracy"
              body="Anthropic-style contextual embeddings, hybrid retrieval, cross-encoder rerank — the full stack the recent papers point to."
            />
            <Pillar
              title="Grounded by default"
              body="Multi-hop agentic loop with deterministic + LLM-judge self-critique. Citations or 'not in your library'."
            />
          </div>
        </div>
      </section>
    </main>
  )
}

function UseCaseCard({
  title,
  tagline,
  body,
  cta,
  href,
  external,
  tagText,
}: {
  title: string
  tagline: string
  body: React.ReactNode
  cta: string
  href: string
  external?: boolean
  tagText?: string
}) {
  const Cmp: React.ElementType = external ? 'a' : Link
  const props = external
    ? { href, target: '_blank', rel: 'noreferrer' }
    : { href }
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 flex flex-col">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">{title}</h3>
        {tagText && (
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            {tagText}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm font-medium text-zinc-700">{tagline}</p>
      <p className="mt-3 text-sm text-zinc-600 leading-relaxed">{body}</p>
      <div className="mt-6">
        <Cmp
          {...props}
          className="inline-flex items-center px-4 py-2 rounded-md bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700"
        >
          {cta}
        </Cmp>
      </div>
    </div>
  )
}

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h4 className="font-medium">{title}</h4>
      <p className="mt-1 text-sm text-zinc-600">{body}</p>
    </div>
  )
}
