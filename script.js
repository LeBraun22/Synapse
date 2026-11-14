// ---------- Supabase setup ----------
const SUPABASE_URL = "https://wrokqokkvfqwseejycog.supabase.co";
const SUPABASE_KEY = "sb_publishable_NCHpkcN3yuZE3AoPvgftxw_fZucBhBj";

// `supabase` is the global from the CDN script; our client is named `db`.
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

// Tiny DOM builder. Children are appended as text nodes, so user content is never parsed as HTML.
function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === "class") node.className = value;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
    }
    for (const child of children) node.append(child);
    return node;
}

function setMsg(id, text, kind = "") {
    const node = $(id);
    node.textContent = text || "";
    node.className = "msg" + (kind ? " " + kind : "");
}

const fmtDate = (iso) => new Date(iso).toLocaleString();

// ---------- State ----------
let user = null;
let profile = null;
let currentForum = null;
let lastUserId; // undefined until the first auth event

// ---------- Tabs ----------
const tabButtons = document.querySelectorAll(".tab-button");
const tabContents = document.querySelectorAll(".tab-content");

function showTab(tab) {
    tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    tabContents.forEach((c) => { c.hidden = c.id !== tab; });
    if (tab === "forums" && !currentForum) loadForums();
}

tabButtons.forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
});

// ---------- Auth ----------
db.auth.onAuthStateChange((_event, session) => {
    user = session?.user ?? null;
    const id = user?.id ?? null;
    if (id === lastUserId) return; // ignore token refreshes
    lastUserId = id;
    // Don't await Supabase calls inside this callback; defer them.
    setTimeout(refreshSession, 0);
});

async function refreshSession() {
    profile = null;
    if (user) {
        const { data } = await db
            .from("profiles")
            .select("id, username")
            .eq("id", user.id)
            .maybeSingle();
        profile = data;
    }
    renderAccount();
    updateForumControls();
    if (currentForum) loadPosts();
    else if (!$("forums").hidden) loadForums();
}

function renderAccount() {
    const body = $("account-body");
    body.replaceChildren();
    setMsg("account-msg", "");

    if (user) {
        const name = profile?.username ?? user.email;
        $("session-status").textContent = "Signed in as " + name;

        body.append(
            el("div", { class: "card" },
                el("h3", {}, name),
                el("p", { class: "small" }, user.email),
                el("div", { class: "row" },
                    el("button", {
                        type: "button",
                        onclick: async () => {
                            const { error } = await db.auth.signOut();
                            if (error) setMsg("account-msg", error.message, "error");
                        },
                    }, "Sign out")
                )
            )
        );
        return;
    }

    $("session-status").textContent = "Not signed in";

    const email = el("input", { type: "email", placeholder: "Email", autocomplete: "email", required: "" });
    const password = el("input", { type: "password", placeholder: "Password (min 6 chars)", autocomplete: "current-password", required: "", minlength: "6" });
    const username = el("input", { type: "text", placeholder: "Username (for new accounts)", maxlength: "30", autocomplete: "username" });

    const form = el("form", { class: "card" },
        el("h3", {}, "Sign in or create an account"),
        email, password, username,
        el("div", { class: "row" },
            el("button", { type: "submit" }, "Sign in"),
            el("button", { type: "button", id: "signup-btn" }, "Create account")
        )
    );

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        setMsg("account-msg", "Signing in...");
        const { error } = await db.auth.signInWithPassword({
            email: email.value.trim(),
            password: password.value,
        });
        if (error) setMsg("account-msg", error.message, "error");
        else setMsg("account-msg", "");
    });

    form.querySelector("#signup-btn").addEventListener("click", async () => {
        const name = username.value.trim();
        if (!email.value.trim() || password.value.length < 6) {
            return setMsg("account-msg", "Enter an email and a password of at least 6 characters.", "error");
        }
        if (name.length < 2 || name.length > 30) {
            return setMsg("account-msg", "Pick a username between 2 and 30 characters.", "error");
        }
        setMsg("account-msg", "Creating account...");
        const { data, error } = await db.auth.signUp({
            email: email.value.trim(),
            password: password.value,
            options: { data: { username: name } },
        });
        if (error) return setMsg("account-msg", error.message, "error");
        if (!data.session) {
            setMsg("account-msg", "Account created. Check your email to confirm, then sign in.", "ok");
        }
    });

    body.append(form);
}

// ---------- Forums ----------
function updateForumControls() {
    const signedIn = !!user;
    $("new-forum-form").hidden = !signedIn;
    $("forum-login-note").hidden = signedIn;
    $("new-post-form").hidden = !signedIn;
    $("post-login-note").hidden = signedIn;
    $("delete-forum").hidden = !(signedIn && currentForum && currentForum.created_by === user.id);
}

async function loadForums() {
    const list = $("forum-list");
    setMsg("forums-msg", "");
    list.replaceChildren(el("p", { class: "small" }, "Loading..."));

    const { data, error } = await db
        .from("forums")
        .select("id, name, description, created_by, created_at, profiles(username)")
        .order("created_at", { ascending: false });

    if (error) {
        list.replaceChildren();
        return setMsg("forums-msg", error.message, "error");
    }
    if (!data.length) {
        list.replaceChildren(el("p", { class: "small" }, "No forums yet. Create the first one!"));
        return;
    }

    list.replaceChildren(...data.map((forum) =>
        el("div", { class: "card" },
            el("h3", {}, forum.name),
            forum.description ? el("p", {}, forum.description) : "",
            el("p", { class: "small" },
                `by ${forum.profiles?.username ?? "unknown"} · ${fmtDate(forum.created_at)}`),
            el("div", { class: "row" },
                el("button", { type: "button", onclick: () => openForum(forum) }, "Open")
            )
        )
    ));
}

$("new-forum-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!user) return;
    const name = $("forum-name").value.trim();
    const description = $("forum-desc").value.trim();
    if (!name) return;

    setMsg("forums-msg", "Creating...");
    const { error } = await db.from("forums").insert({ name, description, created_by: user.id });
    if (error) {
        const dup = error.code === "23505";
        return setMsg("forums-msg", dup ? "A forum with that name already exists." : error.message, "error");
    }
    $("new-forum-form").reset();
    setMsg("forums-msg", "Forum created.", "ok");
    loadForums();
});

function openForum(forum) {
    currentForum = forum;
    $("forums-list-view").hidden = true;
    $("forum-view").hidden = false;
    $("forum-title").textContent = forum.name;
    $("forum-description").textContent = forum.description || "";
    updateForumControls();
    loadPosts();
}

$("back-to-forums").addEventListener("click", () => {
    currentForum = null;
    $("forum-view").hidden = true;
    $("forums-list-view").hidden = false;
    loadForums();
});

$("delete-forum").addEventListener("click", async () => {
    if (!currentForum) return;
    if (!confirm(`Delete "${currentForum.name}" and all its posts?`)) return;
    const { error } = await db.from("forums").delete().eq("id", currentForum.id);
    if (error) return setMsg("posts-msg", error.message, "error");
    $("back-to-forums").click();
});

// ---------- Posts ----------
async function loadPosts() {
    if (!currentForum) return;
    const list = $("post-list");
    setMsg("posts-msg", "");
    list.replaceChildren(el("p", { class: "small" }, "Loading..."));

    const { data, error } = await db
        .from("posts")
        .select("id, title, body, author_id, created_at, profiles(username)")
        .eq("forum_id", currentForum.id)
        .order("created_at", { ascending: false });

    if (error) {
        list.replaceChildren();
        return setMsg("posts-msg", error.message, "error");
    }
    if (!data.length) {
        list.replaceChildren(el("p", { class: "small" }, "No posts yet."));
        return;
    }

    list.replaceChildren(...data.map((post) => {
        const card = el("div", { class: "card" },
            el("h3", {}, post.title),
            el("p", {}, post.body),
            el("p", { class: "small" },
                `${post.profiles?.username ?? "unknown"} · ${fmtDate(post.created_at)}`)
        );
        if (user && post.author_id === user.id) {
            card.append(el("div", { class: "row" },
                el("button", {
                    type: "button",
                    onclick: async () => {
                        const { error: delErr } = await db.from("posts").delete().eq("id", post.id);
                        if (delErr) setMsg("posts-msg", delErr.message, "error");
                        else loadPosts();
                    },
                }, "Delete")
            ));
        }
        return card;
    }));
}

$("new-post-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!user || !currentForum) return;
    const title = $("post-title").value.trim();
    const body = $("post-body").value.trim();
    if (!title || !body) return;

    setMsg("posts-msg", "Posting...");
    const { error } = await db.from("posts").insert({
        forum_id: currentForum.id,
        author_id: user.id,
        title,
        body,
    });
    if (error) return setMsg("posts-msg", error.message, "error");

    $("new-post-form").reset();
    setMsg("posts-msg", "");
    loadPosts();
});

// ---------- Init ----------
renderAccount();
updateForumControls();