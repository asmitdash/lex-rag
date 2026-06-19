import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 bg-white">
        <div className="font-semibold text-lg tracking-tight">Lex-Rag</div>
        <nav className="flex items-center gap-3">
          <Link
            href="/use-cases"
            className="text-sm px-3 py-1.5 rounded-md hover:bg-zinc-100"
          >
            Use cases
          </Link>
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

      <section className="flex-1 flex items-center justify-center px-6 py-20">
        <div className="max-w-3xl">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight">
            The most advanced RAG system you can run.
          </h1>
          <p className="mt-5 text-lg text-zinc-600 max-w-2xl">
            Hybrid retrieval (BM25 + vector + RRF), cross-encoder reranking,
            agentic multi-hop, GraphRAG, and Self-RAG critique — over your own
            corpus, the live web, or both. Cited answers grounded in evidence.
          </p>
          <div className="mt-8 flex gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-zinc-900 text-white font-medium hover:bg-zinc-700"
            >
              Get started — free alpha
            </Link>
            <Link
              href="/use-cases"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-md border border-zinc-300 hover:bg-zinc-100"
            >
              See use cases
            </Link>
          </div>
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <FeatureCard
              title="Pluggable corpus"
              body="Your private docs, the live web, or both fused. Same orchestrator, three modes."
            />
            <FeatureCard
              title="Top-of-class retrieval"
              body="Contextual embeddings, hybrid BM25+vector RRF, BGE cross-encoder rerank, GraphRAG."
            />
            <FeatureCard
              title="Grounded by default"
              body="Multi-hop agentic loop with deterministic + LLM-judge self-critique. No hallucinated citations."
            />
          </div>
        </div>
      </section>
    </main>
  )
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-2 text-sm text-zinc-600">{body}</p>
    </div>
  )
}
