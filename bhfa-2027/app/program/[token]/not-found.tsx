import styles from '@/styles/landing.module.css';

export default function ProgramNotFound() {
  return (
    <main className={styles.shell}>
      <div className={styles.mark}>
        <span>BH</span>
        <span>FACE</span>
      </div>
      <p className={styles.eyebrow}>Beverly Hills Face Academy</p>
      <h1 className={styles.title}>This link is no longer active</h1>
      <p className={styles.copy}>
        Collaboration links can be rotated by a program chair. Ask for the current link and this page
        will open straight into the working program.
      </p>
      <p className={styles.footer}>Where the face is decided.</p>
    </main>
  );
}
