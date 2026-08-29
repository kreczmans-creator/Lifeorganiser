package com.lifeorganiser.app

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Local-time formatting, matching the date formats CLAUDE.md specifies. */
object Clock {

    fun today(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.UK).format(Date())

    fun now(): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.UK).format(Date())

    /** ISO week label, e.g. 2026-W35, used for weekly review notes. */
    fun isoWeek(): String {
        val cal = Calendar.getInstance(Locale.UK).apply {
            firstDayOfWeek = Calendar.MONDAY
            minimalDaysInFirstWeek = 4
        }
        val week = cal.get(Calendar.WEEK_OF_YEAR)
        var year = cal.get(Calendar.YEAR)
        val month = cal.get(Calendar.MONTH)
        // A week in early January can belong to the previous ISO year.
        if (week >= 52 && month == Calendar.JANUARY) year -= 1
        if (week == 1 && month == Calendar.DECEMBER) year += 1
        return String.format(Locale.UK, "%d-W%02d", year, week)
    }
}
