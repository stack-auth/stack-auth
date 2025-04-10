import { Separator, Typography } from "@stackframe/stack-ui";


function Section(props: { title: string, description?: string, children: React.ReactNode }) {
  return (
    <>
      <Separator />
      <div className='flex flex-col sm:flex-row gap-2'>
        <div className='sm:flex-1 flex flex-col justify-center'>
          <Typography className='font-medium'>
            {props.title}
          </Typography>
          {props.description && <Typography variant='secondary' type='footnote'>
            {props.description}
          </Typography>}
        </div>
        <div className='sm:flex-1 sm:items-end flex flex-col gap-2 '>
          {props.children}
        </div>
      </div>
    </>
  );
}
