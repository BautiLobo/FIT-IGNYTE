import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Alta / baja / cambio de rol de las cuentas que entran al panel admin
// (pestaña "Team Access"). Corre con la service_role key porque crear y
// borrar usuarios de Auth no se puede hacer desde el navegador.
//
// Roles:
//   - admin:    email en public.admin_emails (lo que mira is_admin() en las
//               policies). Acceso total, como hasta ahora.
//   - delivery: app_metadata.role = 'delivery' (lo que mira is_delivery()).
//               Solo Delivery Sheet + Kitchen/Chef Display.
// Cada usuario tiene exactamente uno de los dos: al cambiar de rol se
// actualizan ambos lados para que nunca quede admin y delivery a la vez.
//
// Auth propia (deploy con verify_jwt=false, como el resto de funciones del
// proyecto): el caller manda su access token y tiene que ser admin.
//
// Body: { action: 'list' }
//       { action: 'create',   email, password, role }
//       { action: 'set_role', userId, role }
//       { action: 'delete',   userId }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const ROLES = ["admin", "delivery"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  try {
    // ── Quién llama: tiene que ser un admin logueado
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user: caller } } = await db.auth.getUser(token);
    if (!caller?.email) return json({ error: "Not signed in" }, 401);

    const { data: adminRows, error: adminErr } = await db.from("admin_emails").select("email");
    if (adminErr) throw adminErr;
    const adminEmails = new Set((adminRows || []).map(r => r.email.toLowerCase()));
    // admin_emails puede tener mayusculas: se borra por el valor exacto guardado.
    const removeAdminEmail = async (email: string) => {
      const stored = (adminRows || []).map(r => r.email).filter(e => e.toLowerCase() === email.toLowerCase());
      if (!stored.length) return;
      const { error } = await db.from("admin_emails").delete().in("email", stored);
      if (error) throw error;
    };
    if (!adminEmails.has(caller.email.toLowerCase())) return json({ error: "Admins only" }, 403);

    const body = await req.json();
    const { action } = body;

    const roleOf = (u: { email?: string; app_metadata?: Record<string, unknown> }) =>
      u.email && adminEmails.has(u.email.toLowerCase()) ? "admin"
        : u.app_metadata?.role === "delivery" ? "delivery"
        : "none";

    const getUser = async (userId: string) => {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error || !data.user) throw new Error("User not found");
      return data.user;
    };

    // Asigna el rol en los dos lados (admin_emails + app_metadata).
    const applyRole = async (userId: string, email: string, role: string) => {
      const lower = email.toLowerCase();
      if (role === "admin") {
        const { error } = await db.from("admin_emails").upsert({ email: lower });
        if (error) throw error;
      } else {
        await removeAdminEmail(lower);
      }
      // GoTrue mezcla app_metadata con lo que ya hay (no lo reemplaza): para
      // sacar el rol hay que mandarlo en null, borrar la clave no alcanza.
      const { error } = await db.auth.admin.updateUserById(userId, {
        app_metadata: { role: role === "delivery" ? "delivery" : null },
      });
      if (error) throw error;
    };

    // No dejar el panel sin admins.
    const isLastAdmin = (email?: string) =>
      !!email && adminEmails.has(email.toLowerCase()) && adminEmails.size <= 1;

    if (action === "list") {
      const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      const users = data.users.map(u => ({
        id: u.id,
        email: u.email,
        role: roleOf(u),
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      }));
      return json({ users });
    }

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = String(body.role || "");
      if (!email || !email.includes("@")) return json({ error: "Invalid email" }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
      if (!ROLES.includes(role)) return json({ error: "Invalid role" }, 400);

      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: role === "delivery" ? { role: "delivery" } : {},
      });
      if (error) return json({ error: error.message }, 400);
      if (role === "admin") {
        const { error: e2 } = await db.from("admin_emails").upsert({ email });
        if (e2) throw e2;
      }
      return json({ ok: true, id: data.user?.id });
    }

    if (action === "set_role") {
      const role = String(body.role || "");
      if (!ROLES.includes(role)) return json({ error: "Invalid role" }, 400);
      const target = await getUser(String(body.userId || ""));
      if (target.id === caller.id) return json({ error: "You can't change your own role" }, 400);
      if (role !== "admin" && isLastAdmin(target.email)) return json({ error: "Can't remove the last admin" }, 400);
      await applyRole(target.id, target.email!, role);
      return json({ ok: true });
    }

    if (action === "delete") {
      const target = await getUser(String(body.userId || ""));
      if (target.id === caller.id) return json({ error: "You can't delete your own account" }, 400);
      if (isLastAdmin(target.email)) return json({ error: "Can't remove the last admin" }, 400);
      if (target.email) await removeAdminEmail(target.email);
      const { error } = await db.auth.admin.deleteUser(target.id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
