// SlateBuilder Pro is offline while SlateBuilder for Offices is piloted. The
// app itself is kept, unrouted, in _archived/ (Next.js does not serve folders
// whose name starts with an underscore); to bring Pro back, move its pages
// back here. Anyone arriving on an old link sees this notice instead.

export const metadata = {
  title: "SlateBuilder Pro is offline",
  description: "SlateBuilder Pro is offline. Use SlateBuilder for Offices at slatebuilder.ca.",
};

export default function ProOffline() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-16">
      <div className="card p-8">
        <p className="text-sm font-semibold tracking-wide text-sand-600">SlateBuilder Pro</p>
        <h1 className="mt-2 text-2xl font-semibold text-slateBlue-900">
          SlateBuilder Pro is offline
        </h1>
        <p className="mt-3 text-sm leading-6 text-sand-700">
          It is not available at the moment. To build OR slates and a priority waitlist from your
          office&apos;s waitlist, use SlateBuilder for Offices.
        </p>
        <a
          href="https://slatebuilder.ca"
          className="mt-6 inline-block rounded-lg bg-slateBlue-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Go to slatebuilder.ca →
        </a>
      </div>
    </main>
  );
}
