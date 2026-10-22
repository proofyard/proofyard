import "server-only";
import Image from "next/image";
import { EnvLabel } from "../../components/env-label";
import { ExternalStore } from "../../components/external-store";

export default function Compat() {
  return (
    <>
      <p>Server secret: {process.env.SERVER_SECRET}</p>
      <EnvLabel />
      <Image src="/logo.svg" alt="Logo" width={10} height={10} />
      <ExternalStore />
    </>
  );
}
