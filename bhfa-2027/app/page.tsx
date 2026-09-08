import styles from '@/styles/landing.module.css';

export const dynamic = 'force-dynamic';

/**
 * The application has no public front door. Without a collaboration link there
 * is nothing to show — and nothing that hints at what the link looks like.
 */
export default function Home() {
  return (
    <main className={styles.shell}>
      <div className={styles.mark}>
        <span>BH</span>
        <span>FACE</span>
      </div>
      <p className={styles.eyebrow}>Beverly Hills Face Academy</p>
      <h1 className={styles.title}>2027 Scientific Program</h1>
      <p className={styles.copy}>
        The working program opens through a private collaboration link. Ask a program chair to send you
        the current one.
      </p>
      <p className={styles.footer}>Where the face is decided.</p>
    </main>
  );
}
