export default async function handler(req, res) {
      const { playerTag } = req.query;
        
          if (!playerTag) {
              return res.status(400).json({ error: 'Player tag is required' });
                }

                  const token = process.env.CLASH_ROYALE_TOKEN;

                    if (!token) {
                        return res.status(500).json({ error: 'Clash Royale API token is not configured on Vercel' });
                          }

                            try {
                                const formattedTag = playerTag.startsWith('#') ? playerTag : `#${playerTag}`;
                                    const encodedTag = encodeURIComponent(formattedTag);

                                        // Fetch player profile and battle log simultaneously
                                            const [profileRes, battleRes] = await Promise.all([
                                                  fetch(`https://api.clashroyale.com/v1/players/${encodedTag}`, {
                                                          headers: { 'Authorization': `Bearer ${token}` }
                                                                }),
                                                                      fetch(`https://api.clashroyale.com/v1/players/${encodedTag}/battlelog`, {
                                                                              headers: { 'Authorization': `Bearer ${token}` }
                                                                                    })
                                                                                        ]);

                                                                                            if (!profileRes.ok || !battleRes.ok) {
                                                                                                  return res.status(profileRes.status).json({ error: 'Failed to fetch data from Clash Royale API' });
                                                                                                      }

                                                                                                          const profile = await profileRes.json();
                                                                                                              const battleLog = await battleRes.json();

                                                                                                                  return res.status(200).json({ profile, battleLog });
                                                                                                                    } catch (error) {
                                                                                                                        console.error('Proxy error:', error);
                                                                                                                            return res.status(500).json({ error: 'Internal Server Error' });
                                                                                                                              }
                                                                                                                              }
                                                                                                                              
