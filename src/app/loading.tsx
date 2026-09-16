export default function Loading() {
  return (
    <main
      role='status'
      aria-label='正在加载内容'
      className='min-h-screen bg-gray-50 px-6 py-12 dark:bg-[#080b12] sm:px-12'
    >
      <span className='sr-only'>正在加载内容</span>
      <div
        aria-hidden='true'
        className='mx-auto max-w-7xl motion-safe:animate-pulse'
      >
        <div className='mb-8 h-6 w-24 rounded-sm bg-gray-200 dark:bg-white/10' />
        <div className='mb-10 h-[40vh] rounded-2xl bg-gray-200 dark:bg-white/5' />
        <div className='grid grid-cols-3 gap-4 sm:grid-cols-6'>
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className='aspect-2/3 rounded-xl bg-gray-200 dark:bg-white/5'
            />
          ))}
        </div>
      </div>
    </main>
  );
}
