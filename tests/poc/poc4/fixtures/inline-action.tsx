const Page = () => {
  // oxlint-disable-next-line require-await, unicorn/consistent-function-scoping -- コンポーネントの中の関数レベルの "use server"（Fail Closed の確認用）
  const submit = async () => {
    "use server";
  };
  return <form action={submit} />;
};

export default Page;
