export function greeting(name: string | undefined) {
  return name ? `Hello, ${name}` : "Hello, guest";
}
