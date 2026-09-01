import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { useAuth } from './AuthContext.jsx'

export function useIsAdmin() {
  const { user } = useAuth()
  const [isAdmin, setIsAdmin] = useState(undefined) // undefined = loading

  useEffect(() => {
    if (!user) {
      setIsAdmin(false)
      return
    }
    let active = true
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (active) setIsAdmin(data?.is_admin ?? false)
      })
    return () => {
      active = false
    }
  }, [user])

  return { isAdmin: isAdmin === true, loading: isAdmin === undefined }
}
