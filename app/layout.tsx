import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"ResellGo — Les meilleures opportunités resell",description:"Détectez les articles à fort potentiel, analysez leur marge et structurez votre activité de resell.",icons:{icon:"/favicon.png",shortcut:"/favicon.png",apple:"/resellgo-icon.png"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="fr"><body>{children}</body></html>}
