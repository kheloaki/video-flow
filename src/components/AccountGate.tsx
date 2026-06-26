import { Clock, LogOut, ShieldOff } from "lucide-react";
import type { AccountStatus } from "../utils/profileDb";

type Props = {
  status: AccountStatus;
  email?: string | null;
  onLogout: () => void;
};

export function AccountGate({ status, email, onLogout }: Props) {
  const pending = status === "pending";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-6">
        <div
          className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-lg ${
            pending ? "bg-amber-500 shadow-amber-200" : "bg-gray-600 shadow-gray-300"
          }`}
        >
          {pending ? (
            <Clock className="w-8 h-8 text-white" />
          ) : (
            <ShieldOff className="w-8 h-8 text-white" />
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {pending ? "Account pending approval" : "Account inactive"}
          </h1>
          {email ? (
            <p className="text-sm text-gray-500 mt-2 truncate">{email}</p>
          ) : null}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed text-left">
          {pending ? (
            <>
              Your account was created but is not active yet. An admin must approve you before you
              can use Video Flow, Clone Video, AI features, and saved projects.
            </>
          ) : (
            <>
              Your account has been deactivated. You cannot use the app until an admin sets your
              status back to <strong>Active</strong>.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="w-full py-3 bg-gray-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-800 transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Sign out
        </button>
      </div>
    </div>
  );
}
