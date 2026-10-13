import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="flex items-center justify-between border-b bg-white px-6 py-4 md:px-12">
        <Link href="/" className="text-2xl font-bold text-emerald-700">
          CampusLoop
        </Link>

        <div className="flex items-center gap-4">
          <Link href="/login" className="font-medium hover:text-emerald-700">
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
          >
            Get started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center md:py-32">
        <p className="mb-4 font-semibold text-emerald-700">
          Your campus, connected
        </p>

        <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
          Everything on campus,
          <span className="block text-emerald-700">
            better together.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Share useful resources, reconnect people with lost belongings,
          and collaborate with fellow students — all in one place.
        </p>

        <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
          <Link
            href="/register"
            className="rounded-lg bg-emerald-700 px-6 py-3 font-semibold text-white hover:bg-emerald-800"
          >
            Join CampusLoop
          </Link>

          <Link
            href="/login"
            className="rounded-lg border border-slate-300 bg-white px-6 py-3 font-semibold hover:bg-slate-100"
          >
            Already a member?
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-20 md:grid-cols-3">
        <article className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Resource Sharing</h2>
          <p className="mt-3 leading-7 text-slate-600">
            Discover and share useful campus resources with other students.
          </p>
        </article>

        <article className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Lost and Found</h2>
          <p className="mt-3 leading-7 text-slate-600">
            Help missing belongings find their way back to their owners.
          </p>
        </article>

        <article className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Study Collaboration</h2>
          <p className="mt-3 leading-7 text-slate-600">
            Connect with classmates to learn and work on projects together.
          </p>
        </article>
      </section>
    </main>
  );
}