import "./global.css";
import "./theme.scss";
import { StyledButton } from "../../components/styled-button";

import note from "./note.module.scss";
import styles from "./page.module.css";

const Styled = () => (
  <>
    <h1 className={styles.title}>Styled</h1>
    <p className={note.note}>
      Note <em className={note.emphasis}>here</em>
    </p>
    <StyledButton />
  </>
);
export default Styled;
