import "./global.css";
import "./theme.scss";
import styles from "./page.module.css";
import note from "./note.module.scss";
import { StyledButton } from "../../components/styled-button";

export default function Styled() {
  return (
    <>
      <h1 className={styles.title}>Styled</h1>
      <p className={note.note}>
        Note <em className={note.emphasis}>here</em>
      </p>
      <StyledButton />
    </>
  );
}
