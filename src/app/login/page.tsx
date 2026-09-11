import { Logo } from "@/app/Logo";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-14">
      <Logo className="text-sm tracking-wide" />
      <h1 className="font-display mt-3 text-2xl font-semibold">Client login</h1>
      <p className="mt-2 text-sm text-text-dim">
        Enter the access code your FOTOFOTO contact gave you.
      </p>

      <LoginForm />
    </main>
  );
}
