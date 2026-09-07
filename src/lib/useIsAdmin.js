import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext.jsx'

/**
 * Is the signed-in person a platform admin?
 *
 * THE ANSWER IS STAMPED WITH WHOSE IT IS, and `loading` is worked out during
 * render rather than stored. Typing /admin into the address bar used to bounce
 * straight to /entities while following the header link worked, and this is
 * why: the session arrives a beat after the first render, so the hook had
 * already answered "not an admin" for the null user, and RequireAdmin read
 * that as a settled no and redirected before the profile query came back.
 *
 * Resetting the answer from inside the effect does not fix it. React flushes a
 * child's effects before its parent's, and <Navigate> is RequireAdmin's child
 * — it has already redirected on that same commit. Deriving `loading` from
 * whether the stored answer belongs to the CURRENT user means the guard sees
 * "loading" during the render itself, and renders a spinner instead of ever
 * mounting the redirect.
 */
export function useIsAdmin() {
  const { user } = useAuth()
  const [answer, setAnswer] = useState({ userId: null, isAdmin: false })

  useEffect(() => {
    if (!user) {
      setAnswer({ userId: null, isAdmin: false })
      return
    }
    let active = true
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (active) setAnswer({ userId: user.id, isAdmin: data?.is_admin === true })
      })
    return () => {
      active = false
    }
  }, [user])

  return {
    isAdmin: !!user && answer.userId === user.id && answer.isAdmin,
    // Signed out is a settled answer, not a wait. Signed in with an answer
    // belonging to nobody, or to the previous account, is a wait.
    loading: !!user && answer.userId !== user.id,
  }
}
