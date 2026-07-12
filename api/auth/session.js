import { authenticatedSession, getUserInfo } from '../_lib/google.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }

  try {
    const { session, cookie } = await authenticatedSession(req)

    if (!session) {
      sendJson(res, 200, { authenticated: false })
      return
    }

    const user = session.user || (await getUserInfo(session).catch(() => null))

    sendJson(
      res,
      200,
      {
        authenticated: true,
        user: user
          ? {
              email: user.email,
              name: user.name,
              picture: user.picture,
            }
          : null,
      },
      cookie ? [cookie] : [],
    )
  } catch {
    sendJson(res, 401, { authenticated: false })
  }
}
