/** CSS module typing (the tsdown CSS plugin inlines hashed class maps). */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {
  const content: string
  export default content
}
