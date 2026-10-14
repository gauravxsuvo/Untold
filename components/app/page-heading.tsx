type PageHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function PageHeading({ eyebrow, title, description }: PageHeadingProps) {
  return (
    <header className="app-page-heading">
      <p className="app-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="app-page-heading__description">{description}</p>
    </header>
  );
}
