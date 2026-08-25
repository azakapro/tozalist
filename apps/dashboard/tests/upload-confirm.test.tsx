import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { countCsvRows, UploadConfirm } from '../lib/upload-confirm'

afterEach(cleanup)

describe('countCsvRows', () => {
  it('excludes a recognized header row from the billable count', () => {
    expect(countCsvRows('email\na@b.c\nb@c.d\n')).toBe(2)
    expect(countCsvRows('name,e-mail,city\nx,a@b.c,y\n')).toBe(1)
  })

  it('counts every row when there is no recognized header', () => {
    expect(countCsvRows('a@b.c\nb@c.d\nc@d.e\n')).toBe(3)
  })

  it('ignores blank lines and empty files', () => {
    expect(countCsvRows('a@b.c\n\n\nb@c.d\n')).toBe(2)
    expect(countCsvRows('')).toBe(0)
  })
})

describe('UploadConfirm', () => {
  const file = new File(['email\na@b.c\n'], 'list.csv', { type: 'text/csv' })

  it('shows the row count and cost BEFORE anything uploads, on the button itself', () => {
    const onConfirm = vi.fn()
    render(
      <UploadConfirm
        file={file}
        rowCount={1250}
        onConfirm={onConfirm}
        onCancel={() => {}}
        busy={false}
      />,
    )
    expect(screen.getByTestId('row-count').textContent).toBe('1250')
    // The confirmation button literally states the cost.
    expect(screen.getByTestId('confirm-upload').textContent).toBe('Use 1250 credits')
    // Nothing has been confirmed yet.
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('confirm-upload'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancel backs out without confirming', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <UploadConfirm
        file={file}
        rowCount={3}
        onConfirm={onConfirm}
        onCancel={onCancel}
        busy={false}
      />,
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('disables the confirm button while uploading', () => {
    render(
      <UploadConfirm
        file={file}
        rowCount={3}
        onConfirm={() => {}}
        onCancel={() => {}}
        busy={true}
      />,
    )
    expect((screen.getByTestId('confirm-upload') as HTMLButtonElement).disabled).toBe(true)
  })
})
