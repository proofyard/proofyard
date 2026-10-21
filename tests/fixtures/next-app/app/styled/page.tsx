import "./global.css";
import styles from "./page.module.css";
import { StyledButton } from "../../components/styled-button";

export default function Styled() {
  return (
    <>
      <h1 className={styles.title}>Styled</h1>
      <StyledButton />
    </>
  );
}
